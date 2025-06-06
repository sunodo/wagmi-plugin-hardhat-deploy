import type { ContractConfig, Plugin } from "@wagmi/cli";
import type { Abi, Address } from "abitype";
import fs from "node:fs";
import path from "node:path";

export interface ContractExport {
    address: Address;
    abi: Abi;
    // biome-ignore lint/suspicious/noExplicitAny: <explanation>
    linkedData?: any;
}

export interface Export {
    chainId: string;
    name: string;
    contracts: {
        [name: string]: ContractExport;
    };
}

export interface HardhatDeployOptions {
    directory: string;
    includes?: RegExp[];
    excludes?: RegExp[];
    includeNetworks?: string[];
    excludeNetworks?: string[];
    namePrefix?: string;
    nameSuffix?: string;
}

const shouldInclude = (name: string, config: HardhatDeployOptions): boolean => {
    if (config.excludes) {
        // if there is a list of excludes, then if the name matches any of them, then exclude
        for (const exclude of config.excludes) {
            if (exclude.test(name)) {
                return false;
            }
        }
    }
    if (config.includes) {
        // if there is a list of includes, then only include if the name matches any of them
        for (const include of config.includes) {
            if (include.test(name)) {
                return true;
            }
        }
        return false;
    }
    // if there is no list of includes, then include everything
    return true;
};

const shouldIncludeFile = (
    fileName: string,
    config: HardhatDeployOptions
): boolean => {
    // Extract the network name from the file name (assumes format "networkName.json")
    const networkName = path.basename(fileName, ".json");

    // Handle network-based includes
    if (config.includeNetworks && config.includeNetworks.length > 0) {
        if (!config.includeNetworks.includes(networkName)) {
            return false;
        }
    }

    // Handle network-based excludes
    if (config.excludeNetworks && config.excludeNetworks.length > 0) {
        if (config.excludeNetworks.includes(networkName)) {
            return false;
        }
    }

    return true; // Default to include if no specific rules are set
};

const plugin = (config: HardhatDeployOptions): Plugin => {
    const { namePrefix = "", nameSuffix = "" } = config;

    return {
        name: "hardhat-deploy",
        contracts: () => {
            // list all files exported by hardhat-deploy
            const files = fs
                .readdirSync(config.directory)
                .filter((file) => shouldIncludeFile(file, config));

            // build a collection of contracts as expected by wagmi (ContractConfig) indexed by name
            const contracts = files.reduce<Record<string, ContractConfig>>(
                (acc, file) => {
                    // read export file (hardhat-deploy format)
                    const filename = path.join(config.directory, file);
                    const deployment = JSON.parse(
                        fs.readFileSync(filename).toString()
                    ) as Export;
                    const chainId = Number.parseInt(deployment.chainId);

                    // merge this contract with potentially existing contract from other chain
                    for (const [name, { abi, address }] of Object.entries(
                        deployment.contracts
                    )) {
                        if (shouldInclude(name, config)) {
                            // build name with optional prefix and suffix
                            const contractName = `${namePrefix}${name}${nameSuffix}`;

                            const contract = acc[contractName] || {
                                name: contractName,
                                abi,
                                address: {},
                            };
                            const addresses = contract.address as Record<
                                number,
                                Address
                            >;
                            addresses[chainId] = address;
                            acc[contractName] = contract;
                        }
                    }
                    return acc;
                },
                {}
            );

            // simplify address structure if addresses on all chains are the same
            for (const contract of Object.values(contracts)) {
                const addresses = Object.values(
                    contract.address as Record<number, Address>
                );

                // build a unique list of addresses
                const unique = [...new Set(addresses)];

                // replace field with a single address if all addresses are the same
                contract.address =
                    unique.length === 1 ? unique[0] : contract.address;
            }

            return Object.values(contracts);
        },
    };
};

export default plugin;
