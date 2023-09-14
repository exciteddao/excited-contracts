import { useQuery } from "react-query";
import VestingAbi from "./contracts/VestingV1/VestingV1.json";
import { AppConfig } from "./config";
import { Web3 } from "web3";

export function VestingContract({ web3 }: { web3: Web3 }) {
  const { isLoading, error, data } = useQuery("vestingContract", async () => {
    const vesting = new web3.eth.Contract(VestingAbi.abi, AppConfig.Polygon.Mainnet.VestingV1ContractAddress);
    return vesting.methods.MAX_VESTING_DURATION_SECONDS().call();
  });

  if (isLoading) return <h3>Loading...</h3>;

  if (error) return <h3>Error: {JSON.stringify(error)}</h3>;

  return <h3>{`${data}`}</h3>;
}
