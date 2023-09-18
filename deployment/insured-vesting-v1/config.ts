import BN from "bignumber.js";
import { zeroAddress } from "@defi.org/web3-candies";

export interface Config {
  usdcAddress: string;
  xctdAddress: string;
  durationSeconds: number;
  fundingTokenAmountIn: BN;
  projectTokenAmountOut: BN;
  projectWalletAddress: string;
}

const USDC_DECIMALS = 1e6;
const XCTD_DECIMALS = 1e18;
const STRIKE_PRICE = 0.2; // 0.2$ per XCTD

export const _config: Config = {
  usdcAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  // TODO: replace with real address
  xctdAddress: zeroAddress,
  durationSeconds: 60 * 60 * 24 * 365 * 2,
  fundingTokenAmountIn: BN(STRIKE_PRICE).multipliedBy(USDC_DECIMALS),
  projectTokenAmountOut: BN(XCTD_DECIMALS),
  // TODO: replace with real address
  projectWalletAddress: zeroAddress,
};

export type ConfigTuple = [string, string, number, BN, BN, string];

export const config: ConfigTuple = [
  _config.usdcAddress,
  _config.xctdAddress,
  _config.durationSeconds,
  _config.fundingTokenAmountIn,
  _config.projectTokenAmountOut,
  _config.projectWalletAddress,
];
