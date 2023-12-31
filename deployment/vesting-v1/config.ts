import { zeroAddress } from "@defi.org/web3-candies";

export interface Config {
  xctdAddress: string;
  durationSeconds: number;
  projectWalletAddress: string;
}

export const _config: Config = {
  // TODO: replace with real address
  xctdAddress: zeroAddress,
  durationSeconds: 60 * 60 * 24 * 365 * 2,
  // TODO: replace with real address
  projectWalletAddress: zeroAddress,
};

export type ConfigTuple = [string, number, string];

export const config: ConfigTuple = [_config.xctdAddress, _config.durationSeconds, _config.projectWalletAddress];
