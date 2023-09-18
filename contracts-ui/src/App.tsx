import { VestingContract } from "./VestingContract";
import { Container, Heading } from "@chakra-ui/react";

function App() {
  return (
    <main>
      <Container maxW="6xl">
        <Heading as="h1" size="xl" noOfLines={1} mb={4} p={2}>
          Excited Contracts
        </Heading>
        <VestingContract />
      </Container>
    </main>
  );
}

export default App;
