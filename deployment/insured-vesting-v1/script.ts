import { ConfigTuple, _config } from "./config";
import BN from "bignumber.js";
import { zeroAddress } from "@defi.org/web3-candies";
import { DeployParams } from "@defi.org/web3-candies/dist/hardhat";

export const deployInsuredVestingV1 = async (
  deploy: (params: DeployParams) => Promise<string>,
  config: ConfigTuple,
  maxFeePerGas: BN,
  maxPriorityFeePerGas: BN
) => {
  if (config[0] !== _config.usdcAddress) {
    throw new Error("Wrong USDC address");
  }

  if (config[1] === zeroAddress) {
    throw new Error("XCTD address cannot be zero");
  }

  if (config[2] === zeroAddress) {
    throw new Error("Project address cannot be zero");
  }

  if (!config[3].eq(_config.usdcToXctdRate)) {
    throw new Error("Wrong USDC to XCTD rate");
  }

  if (config[4] !== _config.durationSeconds) {
    throw new Error("Wrong vesting duration");
  }

  await deploy({
    contractName: "InsuredVestingV1",
    args: config,
    maxFeePerGas: maxFeePerGas,
    maxPriorityFeePerGas: maxPriorityFeePerGas,
  });
};
