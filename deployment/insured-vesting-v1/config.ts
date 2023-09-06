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
const USDC_DECIMALS = 1e6;
const XCTD_DECIMALS = 1e18;
const STRIKE_PRICE = 0.2; // 0.2$ per XCTD

export const _config: Config = {
  usdcAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  // TODO: replace with real address
  xctdAddress: zeroAddress,
  // TODO: replace with real address
  projectAddress: zeroAddress,

  // (1e6 * 1e20) / 1e18 * 0.2 = 20000000
  xctdToUsdcRate: BN(USDC_DECIMALS).multipliedBy(PRECISION).dividedBy(XCTD_DECIMALS).multipliedBy(STRIKE_PRICE).integerValue(),
  durationSeconds: 60 * 60 * 24 * 365 * 2,
};

export type ConfigTuple = [string, string, string, BN, number];

export const config: ConfigTuple = [_config.usdcAddress, _config.xctdAddress, _config.projectAddress, _config.xctdToUsdcRate, _config.durationSeconds];
