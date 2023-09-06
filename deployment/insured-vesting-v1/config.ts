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

export const _config: Config = {
  usdcAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  // TODO: replace with real address
  xctdAddress: zeroAddress,
  // TODO: replace with real address
  projectAddress: zeroAddress,
  xctdToUsdcRate: BN(USDC_DECIMALS).multipliedBy(PRECISION).dividedBy(XCTD_DECIMALS).dividedBy(5).integerValue(), // Reflects 0.2USD = 1 XCTD, based on Ethereum's USDC having 6 decimals and XCTD having 18 decimals
  durationSeconds: 60 * 60 * 24 * 365 * 2,
};

throw BN(USDC_DECIMALS).multipliedBy(PRECISION).dividedBy(XCTD_DECIMALS).dividedBy(5).integerValue().toString();

export type ConfigTuple = [string, string, string, BN, number];

export const config: ConfigTuple = [_config.usdcAddress, _config.xctdAddress, _config.projectAddress, _config.xctdToUsdcRate, _config.durationSeconds];
