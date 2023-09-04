import { zeroAddress } from "@defi.org/web3-candies";

export interface Config {
  xctdAddress: string;
  durationSeconds: number;
}

export const _config: Config = {
  // TODO: replace with real address
  xctdAddress: zeroAddress,
  durationSeconds: 60 * 60 * 24 * 365 * 2,
};

export const config: [string] = [
  _config.xctdAddress,
  // TODO: pass durationSeconds as constructor arg
  // _config.durationSeconds,
];
