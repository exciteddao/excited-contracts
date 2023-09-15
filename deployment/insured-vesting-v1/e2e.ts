import { Abi, contract, erc20, networks, setWeb3Instance, web3, Contract, sendAndWaitForConfirmations, Token } from "@defi.org/web3-candies";
import { artifact } from "@defi.org/web3-candies/dist/hardhat";
import { InsuredVestingV1 } from "../../typechain-hardhat/contracts/insured-vesting-v1/InsuredVestingV1";
import { config as dotenvConfig } from "dotenv";
import { Account } from "web3-core";
import debug from "debug";

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
  return [project, user];
}

async function setupCli() {
  // setWeb3Instance(new Web3(networks.poly.publicRpcUrl));
  const [project, user] = await prepareUsers();
  const insuredVesting = contract<InsuredVestingV1>(artifact("InsuredVestingV1").abi, config.insuredVestingAddress);
  const xctd = erc20("MockXCXC", config.xctdAddress);
  const usdc = erc20("MockUSDC", config.usdcAddress);

  // process.argv.splice(2, 1);

  // program.command("set-allowance <amount>").action(async (amount) => {
  //   const weiAmount = await usdc.amount(10);
  //   debugLog(`Setting allowance of usdc to ${10} (${weiAmount})...`);

  //   // debugLog(await insuredVesting.methods.setFundingTokenAllocation(user.address, weiAmount).estimateGas({ from: project.address }));
  //   // await insuredVesting.methods.setFundingTokenAllocation(user.address, weiAmount).send({ from: project.address });
  //   await sendAndWaitForConfirmations(insuredVesting.methods.setFundingTokenAllocation(user.address, weiAmount), { from: project.address }, 1, "fast");
  // });

  // program.parse();

  return {
    project,
    user,
    insuredVesting,
    xctd,
    usdc,
  };
}

interface InsuredVestingV1TaskContext {
  xctd: ERC20 & Token;
  usdc: ERC20 & Token;
  insuredVesting: InsuredVestingV1;
  project: Account;
  user: Account;
  args: any;
  hre: any;
}

import { task } from "hardhat/config";
import { ERC20 } from "@defi.org/web3-candies/dist/abi";

function createInsuredVestingV1Task(taskName: string, functionToRun: (context: InsuredVestingV1TaskContext) => {}) {
  return task(`insured-vesting-v1:${taskName}`).setAction(async (args, hre) => {
    const { project, user, insuredVesting, xctd, usdc } = await setupCli();
    return functionToRun({ xctd, usdc, insuredVesting, project, user, args, hre });
  });
}

const debugLog = debug("insured-v1");

createInsuredVestingV1Task("set-allowance", async ({ insuredVesting, project, user, usdc, args }) => {
  const weiAmount = await usdc.amount(args.amount);
  debugLog(`Setting allowance of usdc to ${args.amount} (${weiAmount}) for ${user.address}...`);
  await sendAndWaitForConfirmations(insuredVesting.methods.setFundingTokenAllocation(user.address, weiAmount), { from: project.address }, 1, "fast");
}).addPositionalParam("amount", "Amount of USDC to set as allowance");

createInsuredVestingV1Task("approve-usdc", async ({ insuredVesting, project, user, usdc, args }) => {
  debugLog(`Approving ${args.amount} usdc from ${user.address} to ${insuredVesting.options.address}...`);
  const weiAmount = await usdc.amount(args.amount);
  await sendAndWaitForConfirmations(usdc.methods.approve(insuredVesting.options.address, weiAmount), { from: user.address }, 1, "fast");
}).addPositionalParam("amount", "Amount of USDC to approve");

createInsuredVestingV1Task("approve-xctd", async ({ insuredVesting, project, xctd, usdc, args }) => {
  const fundingAmount = await insuredVesting.methods.fundingTokenTotalAmount().call();
  const totalFundingAmountNeeded = await insuredVesting.methods.fundingTokenToProjectToken(fundingAmount).call();

  debugLog(`Approving ${await xctd.mantissa(totalFundingAmountNeeded)} xctd from ${project.address} to ${insuredVesting.options.address}...`);
  await sendAndWaitForConfirmations(xctd.methods.approve(insuredVesting.options.address, totalFundingAmountNeeded), { from: project.address }, 1, "fast");
});

createInsuredVestingV1Task("fund-contract", async ({ insuredVesting, project, user, usdc, args }) => {
  const { fundingTokenAllocation, fundingTokenAmount } = await insuredVesting.methods.userVestings(user.address).call();
  const allowance = await usdc.methods.allowance(user.address, insuredVesting.options.address).call();

  debugLog(
    `Funding contract with ${args.amount} usdc from ${user.address}; current funding: ${await usdc.mantissa(
      fundingTokenAmount
    )}; current allocation: ${await usdc.mantissa(fundingTokenAllocation)}; allowance ${await usdc.mantissa(allowance)} ...`
  );

  await sendAndWaitForConfirmations(insuredVesting.methods.addFunds(await usdc.amount(args.amount)), { from: user.address }, 1, "fast");
}).addPositionalParam("amount", "Amount of USDC to fund");

createInsuredVestingV1Task("claim", async ({ insuredVesting, project, user, usdc, xctd, args }) => {
  const claimableFor = await insuredVesting.methods.projectTokenClaimableFor(user.address).call();

  debugLog(`claimableFor: ${await xctd.mantissa(claimableFor)};  ...`);

  if (claimableFor === "0") return;

  await sendAndWaitForConfirmations(insuredVesting.methods.claim(user.address), { from: user.address }, 1, "fast");
});

createInsuredVestingV1Task("activate", async ({ insuredVesting, project, user, usdc, xctd, args }) => {
  const timestamp = Math.round(Date.now() / 1000) + parseInt(args.minutesFromNow) * 60;
  debugLog(`Activating vesting ${timestamp}...`);
  await sendAndWaitForConfirmations(insuredVesting.methods.activate(timestamp), { from: project.address }, 1, "fast");
}).addPositionalParam("minutesFromNow", "When to start vesting");

createInsuredVestingV1Task("set-decision", async ({ insuredVesting, project, user, usdc, xctd, args }) => {
  debugLog(`Setting decision ${args.decision === "refund" ? "refund" : "token"}...`);
  await sendAndWaitForConfirmations(insuredVesting.methods.setDecision(args.decision === "refund"), { from: user.address }, 1, "fast");
}).addPositionalParam("decision", "Decision to set");
