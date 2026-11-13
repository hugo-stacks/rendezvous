import { rmSync } from "node:fs";
import { join, resolve } from "node:path";

import { initSimnet } from "@stacks/clarinet-sdk";
import { Cl, cvToString, type ClarityValue } from "@stacks/transactions";
import fc from "fast-check";

import {
  functionToArbitrary,
  getContractNameFromContractId,
  getFunctionsFromContractInterfaces,
  getFunctionsListForContract,
  getSimnetDeployerContractsInterfaces,
} from "./shared";
import type { EnrichedContractInterfaceFunction } from "./shared.types";
import { createIsolatedTestEnvironment } from "./test.utils";

const isolatedTestEnvPrefix = "rendezvous-test-shared-";

describe("Simnet contracts operations", () => {
  it("retrieves the contracts from the simnet", async () => {
    // Setup
    const tempDir = createIsolatedTestEnvironment(
      resolve(__dirname, "example"),
      isolatedTestEnvPrefix,
    );
    const manifestPath = join(tempDir, "Clarinet.toml");
    const simnet = await initSimnet(manifestPath);
    const expectedDeployerContracts = new Map(
      [...simnet.getContractsInterfaces()].filter(
        ([key]) => key.split(".")[0] === simnet.deployer,
      ),
    );

    // Exercise
    const actualDeployerContracts =
      getSimnetDeployerContractsInterfaces(simnet);

    // Verify
    expect(actualDeployerContracts).toEqual(expectedDeployerContracts);

    // Teardown
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("retrieves the contract functions from the simnet", async () => {
    // Setup
    const tempDir = createIsolatedTestEnvironment(
      resolve(__dirname, "example"),
      isolatedTestEnvPrefix,
    );
    const manifestPath = join(tempDir, "Clarinet.toml");
    const simnet = await initSimnet(manifestPath);
    const sutContractsInterfaces = getSimnetDeployerContractsInterfaces(simnet);
    const sutContractsList = [...sutContractsInterfaces.keys()];
    const allFunctionsMap = new Map(
      Array.from(sutContractsInterfaces, ([contractId, contractInterface]) => [
        contractId,
        contractInterface.functions,
      ]),
    );
    const expectedContractFunctionsList = sutContractsList.map(
      (contractId) => allFunctionsMap.get(contractId) || [],
    );

    // Exercise
    const actualContractFunctionsList = sutContractsList.map((contractId) =>
      getFunctionsListForContract(allFunctionsMap, contractId),
    );

    // Verify
    expect(actualContractFunctionsList).toEqual(expectedContractFunctionsList);

    // Teardown
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("extracts the functions from the contract interfaces", async () => {
    // Setup
    const tempDir = createIsolatedTestEnvironment(
      resolve(__dirname, "example"),
      isolatedTestEnvPrefix,
    );
    const manifestPath = join(tempDir, "Clarinet.toml");
    const simnet = await initSimnet(manifestPath);
    const sutContractsInterfaces = getSimnetDeployerContractsInterfaces(simnet);
    const expectedAllFunctionsMap = new Map(
      Array.from(sutContractsInterfaces, ([contractId, contractInterface]) => [
        contractId,
        contractInterface.functions,
      ]),
    );

    // Exercise
    const actualAllFunctionsMap = getFunctionsFromContractInterfaces(
      sutContractsInterfaces,
    );

    // Verify
    expect(actualAllFunctionsMap).toEqual(expectedAllFunctionsMap);

    // Teardown
    rmSync(tempDir, { recursive: true, force: true });
  });
});

describe("Contract identifier parsing", () => {
  it("gets correct contract name from contract identifier", () => {
    const addressCharset = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    const contractNameCharset =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    fc.assert(
      // Arrange
      fc.property(
        fc.string({ unit: fc.constantFrom(...addressCharset) }),
        fc.string({ unit: fc.constantFrom(...contractNameCharset) }),
        (address, contractName) => {
          const contractId = `${address}.${contractName}`;

          // Act
          const actual = getContractNameFromContractId(contractId);

          // Assert
          expect(actual).toBe(contractName);
        },
      ),
    );
  });
});

describe("Optional argument generation", () => {
  const generate = (type: unknown): ClarityValue[] => {
    const fn = {
      name: "f",
      access: "public",
      outputs: {},
      args: [{ name: "x", type }],
    } as unknown as EnrichedContractInterfaceFunction;
    const [arbitrary] = functionToArbitrary(fn, [], {});
    return fc.sample(arbitrary, { seed: 42, numRuns: 500 });
  };

  it.each([
    ["bool", Cl.bool(false)],
    ["int128", Cl.int(0)],
    ["uint128", Cl.uint(0)],
    [{ "string-ascii": { length: 1 } }, Cl.stringAscii("")],
    [{ "string-utf8": { length: 1 } }, Cl.stringUtf8("")],
    [{ buffer: { length: 1 } }, Cl.bufferFromHex("")],
    [{ optional: "bool" }, Cl.none()],
  ])("generates (some %j) for falsy inner value", (inner, expected) => {
    const generated = generate({ optional: inner });

    expect(generated).toContainEqual(Cl.some(expected));
    expect(generated).toContainEqual(Cl.none());
  });
});

describe("Tuple argument generation", () => {
  it("generates tuple values with a regular prototype", () => {
    const fn = {
      name: "f",
      access: "public",
      outputs: {},
      args: [
        {
          name: "x",
          type: { tuple: [{ name: "a", type: "bool" }] },
        },
      ],
    } as unknown as EnrichedContractInterfaceFunction;
    const [arbitrary] = functionToArbitrary(fn, [], {});

    fc.sample(arbitrary, { seed: 42, numRuns: 200 }).forEach((generated) => {
      expect(
        Object.getPrototypeOf((generated as { value: object }).value),
      ).toBe(Object.prototype);
    });
  });
});

describe("Argument generation with a fixed seed", () => {
  it("generates the same values for the same seed", () => {
    const fn = {
      name: "f",
      access: "public",
      outputs: {},
      args: [
        {
          name: "x",
          type: {
            tuple: [
              { name: "a", type: "int128" },
              { name: "b", type: { buffer: { length: 4 } } },
            ],
          },
        },
        {
          name: "y",
          type: {
            response: {
              ok: "uint128",
              error: { "string-ascii": { length: 5 } },
            },
          },
        },
        { name: "z", type: "uint128" },
      ],
    } as unknown as EnrichedContractInterfaceFunction;
    const arbitraries = functionToArbitrary(fn, [], {});

    const actual = fc
      .sample(fc.tuple(...arbitraries), { seed: 42, numRuns: 4 })
      .map((args) => args.map((arg) => cvToString(arg)));

    expect(actual).toEqual([
      ["(tuple (a 9) (b 0x))", '(err "JD")', "u30"],
      ["(tuple (a -994490854) (b 0x0c))", "(ok u1605711835)", "u19"],
      ["(tuple (a -1536816376) (b 0x05))", '(err "")', "u27"],
      ["(tuple (a -25) (b 0x09eb8c))", '(err "mRm~")', "u692493152"],
    ]);
  });
});
