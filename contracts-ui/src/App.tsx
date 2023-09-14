import { QueryClient, QueryClientProvider } from "react-query";
import { VestingContract } from "./VestingContract";
import Web3 from "web3";
import { AppConfig } from "./config";

const queryClient = new QueryClient();
const web3 = new Web3(AppConfig.Polygon.Mainnet.RpcUrl);

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <h1>Excited Contracts</h1>
      <div>
        <VestingContract web3={web3} />
      </div>
    </QueryClientProvider>
  );
}

export default App;
