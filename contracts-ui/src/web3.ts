import { contract, web3 } from "@defi.org/web3-candies";
import { artifact } from "@defi.org/web3-candies/dist/hardhat";
import { VestingV1 } from "../../typechain-hardhat/contracts/vesting-v1";
import { AppConfig } from "./config";

web3().setProvider(AppConfig.Polygon.Mainnet.rpc);

const _artifact = artifact("VestingV1");
const vesting = contract<VestingV1>(_artifact.abi, AppConfig.Polygon.Mainnet.VestingV1ContractAddress);

vesting.methods.MAX_VESTING_DURATION_SECONDS().call().then(console.log);
