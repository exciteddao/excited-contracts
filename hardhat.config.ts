import "dotenv/config";
import { task, HardhatUserConfig } from "hardhat/config";
import "@typechain/hardhat";
import "@nomiclabs/hardhat-web3";
import "hardhat-gas-reporter";
import "hardhat-tracer";
import { askDeployer, askFees, hardhatDefaultConfig, deploy } from "@defi.org/web3-candies/dist/hardhat";
import _ from "lodash";
import "hardhat-watcher";
import "solidity-coverage";
import "@nomicfoundation/hardhat-verify";

import { deployInsuredVestingV1, ConfigTuple as InsuredVestingConfig } from "./deployment/insured-vesting-v1";
import { deployVestingV1, ConfigTuple as VestingConfig } from "./deployment/vesting-v1";

type Contract = "InsuredVesting" | "Vesting";

task("deploy-contract", "Deploy Excited contract")
  .addParam<Contract>("contract", "Contract name")
  .setAction(async (args, hre) => {
    let contractName: string;
    let config: InsuredVestingConfig | VestingConfig;
    let testGrep;

    switch (args.contract) {
      case "InsuredVesting":
        // TODO: confirm name
        contractName = "InsuredVesting";
        config = require("./deployment/insured-vesting-v1/config").config;
        testGrep = "/^insuredvestingv1 deployment config/i";
        break;
      case "Vesting":
        contractName = "Vesting";
        config = require("./deployment/vesting-v1/config-poly-test").config;
        testGrep = "/^vestingv1 deployment config/i";
        break;
      default:
        console.error(`Invalid contract name: ${args.contract}`);
        return;
    }

    console.log("config :", config);
    console.log(`Running deployment script for ${contractName} contract...`);

    console.log("--------------------------------------");

    console.log("Running tests...");

    // TODO Not sure we can actually run the tests b/c when we run on an actual network
    // we don't have balance for deployer etc

    // const result = await hre.run("test", { bail: true, grep: testGrep });

    // if (result === 1) {
    //   console.log("Tests failed! Aborting deployment...");
    //   return;
    // }

    const deployer = process.env.DEPLOYER || (await askDeployer());
    const { max, tip } = await askFees();

    console.log("Deployer: ", deployer);
    console.log("Max fee: ", Number(max));
    console.log("Tip: ", Number(tip));

    if (!args.dry) {
      console.log("Deploying...");

      switch (args.contract) {
        case "InsuredVesting":
          await deployInsuredVestingV1(deploy, config as InsuredVestingConfig, max, tip);
        case "Vesting":
          await deployVestingV1(deploy, config as VestingConfig, max, tip);
      }
    }
  });

task("deploy-mock-erc20-contract", "Deploy Mock ERC20").setAction(async (args, hre) => {
  const deployer = process.env.DEPLOYER || (await askDeployer());
  const { max, tip } = await askFees();

  console.log("Deployer: ", deployer);
  console.log("Max fee: ", Number(max));
  console.log("Tip: ", Number(tip));

  if (!args.dry) {
    console.log("Deploying...");

    // await deploy({
    //   contractName: "MockUSDC",
    //   args: [],
    //   maxFeePerGas: max,
    //   maxPriorityFeePerGas: tip,
    // });

    await deploy({
      contractName: "MockXCXC",
      args: [],
      maxFeePerGas: max,
      maxPriorityFeePerGas: tip,
    });
  }
});

task("tryActivate", "Deploy Mock ERC20").setAction(async (args, hre) => {
  const deployer = process.env.DEPLOYER || (await askDeployer());

  const address = "0x644fe2b58214f765372ef7bed344833fb22d6f81";
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
  etherscan: {
    apiKey: {
      polygon: "5WNFUTK146AG1DMJBKG1VMVB3TH9HPRQBN",
    },
  },
} as HardhatUserConfig);
