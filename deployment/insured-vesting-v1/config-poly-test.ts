import BN from "bignumber.js";
import { bn18, bn6, zeroAddress } from "@defi.org/web3-candies";

export interface Config {
  usdcAddress: string;
  xctdAddress: string;
  projectAddress: string;
  xctdToUsdcRate: BN;
  durationSeconds: number;
}

const PRECISION = 1e20;
const USDC_DECIMALS = 1e9;
const XCTD_DECIMALS = 1e18;
const STRIKE_PRICE = 0.1428; // 0.14$ per XCTD

export const _config: Config = {
  usdcAddress: "0xA24a0C753f14128B500D79d9D5cAb6f4195f9f36",
  // TODO: replace with real address
  xctdAddress: "0xb49d92F90eD85Be05b0e114cb11D2ea48607F2e8",
  // TODO: replace with real address
  projectAddress: "0xC1760d11bb342EBCD4fbE30f3c673558dE1DBd2c",

  // (1e6 * 1e20) / 1e18 * 0.2 = 20000000
  xctdToUsdcRate: BN(USDC_DECIMALS).multipliedBy(PRECISION).dividedBy(XCTD_DECIMALS).multipliedBy(STRIKE_PRICE).integerValue(),
  durationSeconds: 60 * 60 * 24 * 4,
};

export type ConfigTuple = [string, string, string, BN, number];

export const config: ConfigTuple = [_config.usdcAddress, _config.xctdAddress, _config.projectAddress, _config.xctdToUsdcRate, _config.durationSeconds];
