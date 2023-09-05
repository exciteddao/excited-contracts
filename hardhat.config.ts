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

import { deployUninsuredVestingV1, ConfigTuple as UninsuredConfig } from "./deployment/uninsured-vesting-v1";
import { deployInsuredVestingV1, ConfigTuple as InsuredConfig } from "./deployment/insured-vesting-v1";

type Contract = "Insured" | "Uninsured";

task("deploy-contract", "Deploy Excited contract")
  .addParam<Contract>("contract", "Contract name")
  .setAction(async (args, hre) => {
    let contractName: string;
    let config: InsuredConfig | UninsuredConfig;

    switch (args.contract) {
      case "Insured":
        // TODO: confirm name
        contractName = "InsuredVesting";
        config = require("./deployment/insured-vesting-v1/config").config;
        break;
      case "Uninsured":
        contractName = "UninsuredVesting";
        config = require("./deployment/uninsured-vesting-v1/config").config;
      default:
        console.error("Invalid contract name");
        return;
    }

    console.log("config :", config);
    console.log(`Running deployment script for ${contractName} contract...`);

    console.log("--------------------------------------");

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

      switch (args.contract) {
        case "Insured":
          await deployInsuredVestingV1(deploy, config as InsuredConfig, max, tip);
        case "Uninsured":
          await deployUninsuredVestingV1(deploy, config as UninsuredConfig, max, tip);
      }
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
