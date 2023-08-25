import { Token, account, bn18, erc20, BlockInfo, Receipt, web3, bn6 } from "@defi.org/web3-candies";
import { deployArtifact, mineBlock, tag, useChaiBigNumber } from "@defi.org/web3-candies/dist/hardhat";
import BN from "bignumber.js";
import { InsuredVestingV1 } from "../../typechain-hardhat/contracts/insured-vesting-v1/InsuredVestingV1";
import { MockERC20 } from "../../typechain-hardhat/contracts/test/MockERC20";
import { MockUSDC } from "../../typechain-hardhat/contracts/test/MockUSDC";

useChaiBigNumber();

export let deployer: string;
export let user1: string;
export let user2: string;
export let additionalUsers: string[] = [];
export let anyUser: string;
export let project: string;

export let xctd: MockERC20 & Token;
export let mockUsdc: MockERC20 & Token;
export let someOtherToken: MockERC20 & Token;
export let insuredVesting: InsuredVestingV1;

const DAY = 60 * 60 * 24;
export const MONTH = DAY * 30;

export const XCTD_TOKENS_ON_SALE = 1_000_000;
export const USDC_TO_XCTD_RATIO = 7;
export const VESTING_PERIODS = 24;
export const LOCKUP_MONTHS = 6;
export const FUNDING_PER_USER = 10_000;

export async function setup() {
  deployer = await account(9);
  user1 = await account(0);
  user2 = await account(3);
  project = await account(4);
  anyUser = await account(1);
  tag(deployer, "deployer");
  tag(user1, "user1");
  tag(user2, "user2");
  tag(anyUser, "anyUser");

  for (let i = 1; i <= 6; i++) {
    additionalUsers.push(await account(i + 10));
    tag(additionalUsers[i], "additionalUser" + i);
  }
}

export enum Error {
  ZeroAddress = "ZeroAddress",
}

export async function withFixture() {
  someOtherToken = erc20("MockERC20", (await deployArtifact<MockERC20>("MockERC20", { from: deployer }, [bn18(1e9), "SomeOtherToken"])).options.address);
  mockUsdc = erc20("MockERC20", (await deployArtifact<MockUSDC>("MockUSDC", { from: deployer }, [bn6(1e9), "MockUSDC"])).options.address);
  xctd = erc20("MockERC20", (await deployArtifact<MockERC20>("MockERC20", { from: deployer }, [bn18(1e9), "XCTD"])).options.address);
  insuredVesting = await deployArtifact<InsuredVestingV1>("InsuredVestingV1", { from: deployer }, [
    mockUsdc.options.address,
    xctd.options.address,
    project,
    bn18(USDC_TO_XCTD_RATIO).dividedBy(bn6(1)), // 7*10^18 / 1,000,000 (7XCTD per USDC)
    await getDefaultStartTime(),
  ]);

  for (const target of [user1, user2].concat(additionalUsers)) {
    await mockUsdc.methods.transfer(target, await mockUsdc.amount(FUNDING_PER_USER)).send({ from: deployer });
    await mockUsdc.methods.approve(insuredVesting.options.address, await mockUsdc.amount(FUNDING_PER_USER)).send({ from: target });
  }

  await transferXctdToVesting();
}

export async function transferXctdToVesting() {
  await xctd.methods.transfer(insuredVesting.options.address, await xctd.amount(XCTD_TOKENS_ON_SALE)).send({ from: deployer });
}

export function advanceDays(days: number): Promise<BlockInfo> {
  return mineBlock(days * DAY);
}

export function advanceMonths(months: number): Promise<BlockInfo> {
  return mineBlock(months * MONTH);
}

export async function getCurrentTimestamp(): Promise<string | number | BN> {
  return (await web3().eth.getBlock("latest")).timestamp;
}

export async function getDefaultStartTime(): Promise<BN> {
  return await BN(await getCurrentTimestamp()).plus(MONTH * 6);
}
