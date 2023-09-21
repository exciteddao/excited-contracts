import { contract, erc20, web3, sendAndWaitForConfirmations } from "@defi.org/web3-candies";
import { artifact } from "@defi.org/web3-candies/dist/hardhat";
import { InsuredVestingV1 } from "../../typechain-hardhat/contracts/insured-vesting-v1/InsuredVestingV1";
import { config as dotenvConfig } from "dotenv";
import debug from "debug";
import Table from "cli-table3";

dotenvConfig();

const config = {
  projectKey: process.env.DEPLOYER!,
  userKey: process.env.USER_K!,
  insuredVestingAddress: "0x2bC7866170364fBB4601e9D6A120C27D1e4fE17A",
  xctdAddress: "0xb49d92F90eD85Be05b0e114cb11D2ea48607F2e8",
  usdcAddress: "0xA24a0C753f14128B500D79d9D5cAb6f4195f9f36",
};

async function prepareUsers() {
  const project = web3().eth.accounts.privateKeyToAccount(config.projectKey);
  const user = web3().eth.accounts.privateKeyToAccount(config.userKey);
  web3().eth.accounts.wallet.add(project).address;
  web3().eth.accounts.wallet.add(user).address;
  return user;
}

async function createContext() {
  const insuredVesting = contract<InsuredVestingV1>(artifact("InsuredVestingV1").abi, config.insuredVestingAddress);
  const xctd = erc20("MockXCXC", config.xctdAddress);
  const usdc = erc20("MockUSDC", config.usdcAddress);

  return {
    insuredVesting,
    projectToken: xctd,
    fundingToken: usdc,
  };
}

import { task as hardhatTask } from "hardhat/config";
import { InsuredVestingV1Lib } from "./InsuredVestingV1Lib";
import { InsuredVestingV1UiLib } from "./InsuredVestingV1UiLib";
import { HardhatRuntimeEnvironment } from "hardhat/types";

function task(taskName: string, functionToRun: (lib: InsuredVestingV1Lib, user: string, args: any, hre: HardhatRuntimeEnvironment) => {}) {
  return hardhatTask(`insured-vesting-v1:${taskName}`).setAction(async (args, hre) => {
    const user = await prepareUsers();
    const lib = new InsuredVestingV1Lib(await createContext());
    return functionToRun(lib, user.address, args, hre);
  });
}

const debugLog = debug("insured-v1");

// task("approve-usdc", async ({ insuredVesting, project, user, usdc, args }) => {
//   debugLog(`Approving ${args.amount} usdc from ${user.address} to ${insuredVesting.options.address}...`);
//   const weiAmount = await usdc.amount(args.amount);
//   await sendAndWaitForConfirmations(usdc.methods.approve(insuredVesting.options.address, weiAmount), { from: user.address }, 1, "fast");
// }).addPositionalParam("amount", "Amount of USDC to approve");

// task("approve-xctd", async ({ insuredVesting, project, xctd, usdc, args }) => {
//   const fundingAmount = await insuredVesting.methods.fundingTokenTotalAmount().call();
//   const totalFundingAmountNeeded = await insuredVesting.methods.fundingTokenToProjectToken(fundingAmount).call();

//   debugLog(`Approving ${await xctd.mantissa(totalFundingAmountNeeded)} xctd from ${project.address} to ${insuredVesting.options.address}...`);
//   await sendAndWaitForConfirmations(xctd.methods.approve(insuredVesting.options.address, totalFundingAmountNeeded), { from: project.address }, 1, "fast");
// });

// task("fund-contract", async ({ insuredVesting, project, user, usdc, args }) => {
//   const { fundingTokenAllocation, fundingTokenAmount } = await insuredVesting.methods.userVestings(user.address).call();
//   const allowance = await usdc.methods.allowance(user.address, insuredVesting.options.address).call();

//   debugLog(
//     `Funding contract with ${args.amount} usdc from ${user.address}; current funding: ${await usdc.mantissa(
//       fundingTokenAmount
//     )}; current allocation: ${await usdc.mantissa(fundingTokenAllocation)}; allowance ${await usdc.mantissa(allowance)} ...`
//   );

//   await sendAndWaitForConfirmations(insuredVesting.methods.addFunds(await usdc.amount(args.amount)), { from: user.address }, 1, "fast");
// }).addPositionalParam("amount", "Amount of USDC to fund");

// task("claim", async ({ insuredVesting, project, user, usdc, xctd, args }) => {
//   const claimableFor = await insuredVesting.methods.projectTokenClaimableFor(user.address).call();

//   debugLog(`claimableFor: ${await xctd.mantissa(claimableFor)};  ...`);

//   if (claimableFor === "0") return;

//   await sendAndWaitForConfirmations(insuredVesting.methods.claim(user.address), { from: user.address }, 1, "fast");
// });

// task("activate", async ({ insuredVesting, project, user, usdc, xctd, args }) => {
//   const timestamp = Math.round(Date.now() / 1000) + parseInt(args.minutesFromNow) * 60;
//   debugLog(`Activating vesting ${timestamp}...`);
//   await sendAndWaitForConfirmations(insuredVesting.methods.activate(timestamp), { from: project.address }, 1, "fast");
// }).addPositionalParam("minutesFromNow", "When to start vesting");

// task("set-decision", async ({ insuredVesting, project, user, usdc, xctd, args }) => {
//   debugLog(`Setting decision ${args.decision === "refund" ? "refund" : "token"}...`);
//   await sendAndWaitForConfirmations(insuredVesting.methods.setDecision(args.decision === "refund"), { from: user.address }, 1, "fast");
// }).addPositionalParam("decision", "Decision to set");

task("set-allowance", async (lib, user, args, hre) => {
  const weiAmount = await lib.context.fundingToken.amount(args.amount);
  await sendAndWaitForConfirmations(
    lib.context.insuredVesting.methods.setFundingTokenAllocation(user, weiAmount),
    { from: await lib.context.insuredVesting.methods.projectWallet().call() },
    1,
    "fast"
  );

  await printUserStatus(new InsuredVestingV1UiLib(lib), user);
}).addPositionalParam("amount", "Amount of USDC to set as allowance");

task("claim", async (lib, user, args, hre) => {
  await sendAndWaitForConfirmations(lib.context.insuredVesting.methods.claim(user), { from: user }, 1, "fast");
});

task("status", async (lib, user) => {
  const uiLib = new InsuredVestingV1UiLib(lib);

  const contractStatus = await uiLib.contractStatus();
  let table = new Table({});
  table.push(
    ["Vesting Start Time", contractStatus.vestingStartTime],
    ["Vesting End Time", contractStatus.vestingEndTime],
    ["Total Funded", contractStatus.totalFunded],
    ["Total Claimed", contractStatus.totalClaimed],
    ["Project Tokens per Funding Token", contractStatus.projectTokensPerFundingToken],
    ["Funding Token Balance", contractStatus.fundingTokenBalance],
    ["Project Token Balance", contractStatus.projectTokenBalance]
  );
  console.log("\nInsured Vesting");
  console.log(table.toString());

  const projectStatus = await uiLib.projectStatus();
  table = new Table({});
  table.push(["Wallet", projectStatus.wallet]);
  table.push(["Funding token balance", projectStatus.fundingTokenBalance]);
  table.push(["Project token balance", projectStatus.projectTokenBalance]);
  console.log("\nProject");
  console.log(table.toString());

  await printUserStatus(uiLib, user);
});

async function printUserStatus(uiLib: InsuredVestingV1UiLib, user: string) {
  for (const userStatus of await uiLib.usersStatus(user)) {
    const table = new Table({ head: ["", "Balance", "Allocation", "Funded", "Vested", "Claimable", "Claimed"] });
    table.push([
      "Funding token",
      userStatus.fundingTokenBalance,
      userStatus.fundingTokenAllocation,
      userStatus.fundingTokenAmount,
      userStatus.fundingTokenVested,
      userStatus.fundingTokenClaimable,
      userStatus.fundingTokenClaimed,
    ]);

    table.push(["Project token", userStatus.projectTokenBalance, "N/A", "N/A", userStatus.projectTokenVested, userStatus.projectTokenClaimable, "N/A"]);

    table.push(["Refund?", userStatus.shouldRefund]);
    console.log("\nUser: ", userStatus.user);
    console.log(table.toString());
  }
}
