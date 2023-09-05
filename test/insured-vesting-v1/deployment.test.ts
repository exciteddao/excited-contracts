import { expect } from "chai";
import { withFixture, setup, insuredVesting } from "./fixture";
import { erc20 } from "@defi.org/web3-candies";
import BN from "bignumber.js";

describe.skip("InsuredVestingV1 deployment", () => {
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
    expect(await insuredVesting.methods.DURATION().call()).to.equal(String(60 * 60 * 24 * 365 * 2));
  });
});
