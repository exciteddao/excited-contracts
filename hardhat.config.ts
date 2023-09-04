import "dotenv/config";
import { task, HardhatUserConfig, types } from "hardhat/config";
import "@typechain/hardhat";
import "@nomiclabs/hardhat-web3";
import "hardhat-gas-reporter";
import "hardhat-tracer";
import { askDeployer, askFees, hardhatDefaultConfig, deploy } from "@defi.org/web3-candies/dist/hardhat";
import _ from "lodash";
import "hardhat-watcher";
import "solidity-coverage";
import { config } from "./deployment/insured-vesting-v1/config";

// TODO: confirm name
const insuredContractDeployedName = "InsuredVesting";

task("deploy-insured", "Deploy InsuredVesting contract")
  .addOptionalParam("dry", "dry run", true, types.boolean)
  .setAction(async (args, hre) => {
    console.log("Running tests...");
    const result = await hre.run("test", { bail: true });
    if (result === 1) {
      console.log("Tests failed! Aborting deployment...");
      return;
    }

    const deployer = process.env.DEPLOYER || (await askDeployer());
    const { max, tip } = await askFees();

    console.log("Deployer: ", deployer);
    console.log("Max fee: ", Number(max));
    console.log("Tip: ", Number(tip));

    if (!args.dry) {
      console.log("Deploying...");
      await deploy({ contractName: insuredContractDeployedName, args: config, maxFeePerGas: max, maxPriorityFeePerGas: tip });
    }
  });

export default _.merge(hardhatDefaultConfig(), {
  networks: {
    hardhat: {},
  },
  mocha: {
    bail: false,
  },
  watcher: {
    test: {
      tasks: ["test"],
    },
  },
} as HardhatUserConfig);
