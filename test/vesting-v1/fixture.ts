import { Token, account, bn18, erc20 } from "@defi.org/web3-candies";
import { deployArtifact, tag, useChaiBigNumber } from "@defi.org/web3-candies/dist/hardhat";
import BN from "bignumber.js";
import { VestingV1 } from "../../typechain-hardhat/contracts/vesting-v1";
import { MockERC20 } from "../../typechain-hardhat/contracts/test/MockERC20";
import { config } from "../../deployment/vesting-v1/config";
import { DAY, getCurrentTimestamp, advanceDays } from "../utils";

useChaiBigNumber();

export let deployer: string;
export let user1: string;
export let user2: string;
export let anyUser: string;
export let projectWallet: string;
export let differentProjectWallet: string;

export let projectToken: MockERC20 & Token;
export let someOtherToken: MockERC20 & Token;
export let vesting: VestingV1;

export const VESTING_DURATION_SECONDS = DAY * 730;

export const PROJECT_TOKENS_ON_SALE = 1_000_000;
export const LOCKUP_MONTHS = 6;
export const TOKENS_PER_USER = 10_000;

export async function setup() {
  deployer = await account(9);
  user1 = await account(0);
  user2 = await account(3);
  anyUser = await account(1);
  projectWallet = await account(5);
  differentProjectWallet = await account(6);

  tag(deployer, "deployer");
  tag(user1, "user1");
  tag(user2, "user2");
  tag(anyUser, "anyUser");
  tag(projectWallet, "projectWallet");
  tag(differentProjectWallet, "differentProjectWallet");
}

export async function withFixture() {
  projectToken = erc20("MockERC20", (await deployArtifact<MockERC20>("MockERC20", { from: projectWallet }, [bn18(1e9), "ProjectToken"])).options.address);
  someOtherToken = erc20("MockERC20", (await deployArtifact<MockERC20>("MockERC20", { from: deployer }, [bn18(1e9), "SomeOtherToken"])).options.address);

  // TODO TEMPORARY: until having production PROJECT_TOKEN address
  const testConfig = [...config];
  testConfig[0] = projectToken.options.address;
  testConfig[2] = projectWallet;
  // END TEMPORARY

  vesting = await deployArtifact<VestingV1>("VestingV1", { from: deployer }, testConfig);
}

export enum Error {
  ZeroAddress = "ZeroAddress",
  StartTimeTooDistant = "StartTimeTooDistant",
  StartTimeInPast = "StartTimeInPast",
  VestingNotStarted = "VestingNotStarted",
  AlreadyActivated = "AlreadyActivated",
  NothingToClaim = "NothingToClaim",
  TotalAmountZero = "TotalAmountZero",
  OnlyProjectOrSender = "OnlyProjectOrSender",
  NotActivated = "NotActivated",
  EmergencyReleased = "EmergencyReleased",
  EmergencyNotReleased = "EmergencyNotReleased",
}

export async function approveProjectTokenToVesting(amount = PROJECT_TOKENS_ON_SALE) {
  await projectToken.methods.approve(vesting.options.address, await projectToken.amount(amount)).send({ from: projectWallet });
}

export async function getDefaultStartTime(): Promise<BN> {
  return BN(await getCurrentTimestamp()).plus(DAY * 3);
}

export async function setAmountForUser1(amount = TOKENS_PER_USER) {
  await vesting.methods.setAmount(user1, await projectToken.amount(amount)).send({ from: projectWallet });
}

export async function setAmountForUser2(amount = TOKENS_PER_USER) {
  await vesting.methods.setAmount(user2, await projectToken.amount(amount)).send({ from: projectWallet });
}

export async function vestedAmount(days: number) {
  let amount = BN(TOKENS_PER_USER)
    .dividedBy(VESTING_DURATION_SECONDS)
    .multipliedBy(DAY * days);
  return projectToken.amount(amount);
}

export async function activateAndReachStartTime() {
  await vesting.methods.activate(await getDefaultStartTime()).send({ from: projectWallet });
  await advanceDays(3);
}
