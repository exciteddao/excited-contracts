import VestingAbi from "./generated/contracts/vesting-v1/VestingV1.json";
import { VestingV1 } from "./generated/contracts/vesting-v1/VestingV1";
import { useState } from "react";
import { NonPayableTransactionObject } from "./generated/types";
import {
  Accordion,
  AccordionButton,
  AccordionIcon,
  AccordionItem,
  AccordionPanel,
  Box,
  Button,
  Code,
  Input,
  VStack,
  Text,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Tabs,
} from "@chakra-ui/react";
import { CodeDisplay } from "./components";

type AbiItemProps = {
  contract: VestingV1;
  abi: (typeof VestingAbi.abi)[number];
};

function AbiItem({ contract, abi }: AbiItemProps) {
  const [result, setResult] = useState<string>("");

  const InputsForm = abi.inputs.map((input: { name?: string; type: string }, inputIndex) => (
    <Box key={inputIndex}>
      <label htmlFor={`input-${inputIndex}`}>
        <Text as="small">
          {input.name || `arg${inputIndex}`}: {input.type}
        </Text>
      </label>
      <Input id={`input-${inputIndex}`} />
    </Box>
  ));

  return (
    <AccordionItem>
      <AccordionButton justifyContent="space-between">
        <CodeDisplay type={abi.type} name={abi.name} inputs={abi.inputs} outputs={abi.outputs} />
        <AccordionIcon />
      </AccordionButton>
      <AccordionPanel>
        {abi.name && abi.type === "function" && (
          <VStack spacing={4} alignItems="flex-start">
            {InputsForm}
            <Button
              onClick={() => {
                const methodName: keyof typeof contract.methods = abi.name as keyof typeof contract.methods;
                const args = abi.inputs.map((input) => input.name || "");

                // eslint-disable-next-line prefer-spread
                const functionToCall = (contract.methods[methodName] as (...args: unknown[]) => NonPayableTransactionObject<unknown>).apply(null, args);
                functionToCall.call().then((res: unknown) => {
                  setResult(`${res}`);
                });
              }}
            >
              Run
            </Button>
            <Box width="100%">
              <Text as="small">Result:</Text>
              <Box backgroundColor="gray.100" width="100%" minHeight="100px" border="1px solid #ccc" overflowY="scroll">
                {result !== "" && <Code p={4}>{result}</Code>}
              </Box>
            </Box>
          </VStack>
        )}
      </AccordionPanel>
    </AccordionItem>
  );
}

type VestingContractProps = {
  contract: VestingV1;
};

export function VestingContract({ contract }: VestingContractProps) {
  const functions = VestingAbi.abi.filter((abi) => abi.type === "function");
  const readFunctions = [];
  const writeFunctions = [];

  for (const func of functions) {
    if (func.stateMutability === "view" || func.stateMutability === "pure") {
      readFunctions.push(func);
    } else {
      writeFunctions.push(func);
    }
  }

  const events = VestingAbi.abi.filter((abi) => abi.type === "event");
  const errors = VestingAbi.abi.filter((abi) => abi.type === "error");
  const constructor = VestingAbi.abi.filter((abi) => abi.type === "constructor");

  return (
    <Tabs>
      <TabList>
        <Tab>Constructor</Tab>
        <Tab>Read</Tab>
        <Tab>Write</Tab>
        <Tab>Events</Tab>
        <Tab>Errors</Tab>
      </TabList>

      <TabPanels>
        <TabPanel>
          <VStack alignItems="flex-start">
            {constructor.map((abi, index) => (
              <CodeDisplay key={`contructor-${index}`} type={abi.type} name={abi.name} inputs={abi.inputs} outputs={abi.outputs} />
            ))}
          </VStack>
        </TabPanel>
        <TabPanel>
          <Accordion allowToggle>
            {readFunctions.map((abi, index) => (
              <AbiItem key={`read-${index}`} contract={contract} abi={abi} />
            ))}
          </Accordion>
        </TabPanel>
        <TabPanel>
          <Accordion allowToggle>
            {writeFunctions.map((abi, index) => (
              <AbiItem key={`write-${index}`} contract={contract} abi={abi} />
            ))}
          </Accordion>
        </TabPanel>
        <TabPanel>
          <VStack alignItems="flex-start">
            {events.map((abi, index) => (
              <CodeDisplay key={`events-${index}`} type={abi.type} name={abi.name} inputs={abi.inputs} outputs={abi.outputs} />
            ))}
          </VStack>
        </TabPanel>
        <TabPanel>
          <VStack alignItems="flex-start">
            {errors.map((abi, index) => (
              <CodeDisplay key={`errors-${index}`} type={abi.type} name={abi.name} inputs={abi.inputs} outputs={abi.outputs} />
            ))}
          </VStack>
        </TabPanel>
      </TabPanels>
    </Tabs>
  );
}
