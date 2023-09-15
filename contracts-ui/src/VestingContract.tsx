import VestingAbi from "./generated/contracts/vesting-v1/VestingV1.json";
import { VestingV1 } from "./generated/contracts/vesting-v1/VestingV1";
import { useState } from "react";
import { NonPayableTransactionObject } from "./generated/types";
import { Accordion, AccordionButton, AccordionIcon, AccordionItem, AccordionPanel, Box, Button, Code, Input, VStack, Text } from "@chakra-ui/react";

type AbiItemProps = {
  contract: VestingV1;
  abi: (typeof VestingAbi.abi)[number];
};

function AbiItem({ contract, abi }: AbiItemProps) {
  const [result, setResult] = useState<string>("");

  const inputsString = abi.inputs.map((input: { name?: string; type: string }, inputIndex) => `${input.name || `arg${inputIndex}`}: ${input.type}`).join(", ");

  const outputsString = abi.outputs && abi.outputs.length > 0 ? abi.outputs.map((output: { name?: string; type: string }) => output.type).join(", ") : "";

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
        <Code backgroundColor="transparent">
          <span style={{ color: "#a00" }}>{abi.type}</span> {abi.name || ""}({inputsString}) <span style={{ color: "#04c" }}>{outputsString}</span>
        </Code>
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
  const Abi = VestingAbi.abi
    .sort((a, b) => {
      if (a.type === "function" && b.type !== "function") {
        return -1;
      }

      if (a.type !== "function" && b.type === "function") {
        return 1;
      }

      return 0;
    })
    .map((abi, index) => <AbiItem key={index} contract={contract} abi={abi} />);

  return <Accordion allowToggle>{Abi}</Accordion>;
}
