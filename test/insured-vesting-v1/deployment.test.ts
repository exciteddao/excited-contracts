import { assert, expect } from "chai";
import { withFixture, setup, insuredVesting } from "./fixture";
import { bn18, bn6, erc20, zero, zeroAddress } from "@defi.org/web3-candies";
import BN from "bignumber.js";
import { deployInsuredVestingV1, _config } from "../../deployment/insured-vesting-v1";
import sinon from "sinon";

describe("InsuredVestingV1 deployment config", () => {
  before(async () => await setup());

  beforeEach(async () => withFixture());

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
  it("project xctd balance must be over [TODO]", async () => {
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

describe("InsuredVestingV1 deployment script", () => {
  const web3CandiesStub = {
    deploy: sinon.stub(),
  };

  it("should deploy with correct contract name and arguments", async () => {
    await deployInsuredVestingV1(web3CandiesStub.deploy, new BN(10), new BN(10));
    expect(web3CandiesStub.deploy.calledOnce).to.be.true;
    expect(web3CandiesStub.deploy.firstCall.args[0]).to.deep.equal({
      contractName: "InsuredVestingV1",
      args: [_config.usdcAddress, _config.xctdAddress, _config.projectAddress, _config.usdcToXctdRate, _config.durationSeconds],
      maxFeePerGas: new BN(10),
      maxPriorityFeePerGas: new BN(10),
    });
  });
});
