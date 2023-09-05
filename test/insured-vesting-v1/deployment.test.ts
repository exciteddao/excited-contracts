import { expect } from "chai";
import { withFixture, setup, deployer, project } from "./fixture";
import { erc20, bn18, Token, account } from "@defi.org/web3-candies";
import BN from "bignumber.js";
import { config } from "../../deployment/insured-vesting-v1";
import { deployArtifact, impersonate, mineBlock, setBalance, tag, useChaiBigNumber } from "@defi.org/web3-candies/dist/hardhat";
import { MockERC20 } from "../../typechain-hardhat/contracts/test/MockERC20";
import { InsuredVestingV1 } from "../../typechain-hardhat/contracts/insured-vesting-v1/InsuredVestingV1";

let insuredVesting: InsuredVestingV1;
let xctd: Token;
let deployer: string;

describe("InsuredVestingV1 deployment", () => {
  before(async () => {
    deployer = await account(9);
    xctd = erc20("MockERC20", (await deployArtifact<MockERC20>("MockERC20", { from: deployer }, [bn18(1e9), "XCTD"])).options.address);

    // TODO TEMPORARY: until having production XCTD & project addresses
    const testConfig = [...config];
    testConfig[1] = xctd.options.address;
    testConfig[2] = await account(4);
    // END TEMPORARY

    insuredVesting = await deployArtifact<InsuredVestingV1>("InsuredVestingV1", { from: deployer }, testConfig);
  });

  it("xctd address cannot be zero", async () => {
    const xctd = await insuredVesting.methods.XCTD().call();
    expect(xctd.toLowerCase()).to.not.match(/^0x0+$/);
  });

  it("xctd must have 18 decimals", async () => {
    const xctd = await insuredVesting.methods.XCTD().call();
    expect(await erc20("XCTD", xctd).decimals()).to.equal(18);
  });

  it("usdc address cannot be zero", async () => {
    const usdc = await insuredVesting.methods.USDC().call();
    expect(usdc.toLowerCase()).to.not.match(/^0x0+$/);
  });

  it("usdc must have 6 decimals", async () => {
    const usdc = await insuredVesting.methods.USDC().call();
    expect(await erc20("USDC", usdc).decimals()).to.equal(6);
  });

  it("project address cannot be zero", async () => {
    const project = await insuredVesting.methods.project().call();
    expect(project.toLowerCase()).to.not.match(/^0x0+$/);
  });

  // TODO define this amount
  it.skip("project xctd balance must be over [TODO]", async () => {
    const project = await insuredVesting.methods.project().call();
    const xctd = erc20("XCTD", await insuredVesting.methods.XCTD().call());
    expect(await xctd.methods.balanceOf(project).call()).to.be.bignumber.greaterThan(await xctd.amount(999_999_999));
  });

  it("usdc to xctd rate must be at least 1:1", async () => {
    const usdcToXctdRate = BN(await insuredVesting.methods.USDC_TO_XCTD_RATE().call());
    expect(usdcToXctdRate).to.be.bignumber.gte(1e12);
  });

  it("duration is 2 years", async () => {
    expect(await insuredVesting.methods.VESTING_DURATION().call()).to.equal(String(60 * 60 * 24 * 365 * 2));
  });
});
