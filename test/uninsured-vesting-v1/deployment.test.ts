import { expect } from "chai";
import { withFixture, setup, uninsuredVesting } from "./fixture";

describe("UninsuredVestingV1 deployment", () => {
  before(async () => await setup());

  beforeEach(async () => withFixture());

  // TODO: reenable this when config is using real XCTD address
  it.skip("xctd address cannot be zero", async () => {
    expect((await uninsuredVesting.methods.XCTD().call()).toLowerCase()).to.not.match(/^0x0+$/);
  });

  it("duration is 2 years", async () => {
    expect(await uninsuredVesting.methods.DURATION().call()).to.equal(String(60 * 60 * 24 * 365 * 2));
  });
});
