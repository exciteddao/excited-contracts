import { Input, AccordionItem, AccordionButton, AccordionIcon, AccordionPanel, VStack, Button, Code, Box, Text, Alert } from "@chakra-ui/react";
import { useState } from "react";
import { CodeDisplay } from "./CodeDisplay";
import VestingAbi from "../generated/contracts/vesting-v1/VestingV1.json";
import { SmartContract } from "@thirdweb-dev/react";
import { useForm } from "react-hook-form";

type FunctionAccordionItemProps = {
  contract: SmartContract;
  abi: (typeof VestingAbi.abi)[number];
};

export function FunctionAccordionItem({ contract, abi }: FunctionAccordionItemProps) {
  const [result, setResult] = useState<string>("");
  const [error, setError] = useState<string>();
  const { register, handleSubmit, formState } = useForm();

  const InputsForm = abi.inputs.map((input: { name?: string; type: string }, inputIndex) => (
    <Box key={inputIndex}>
      <label htmlFor={`input-${inputIndex}`}>
        <Text as="small">
          {input.name || `arg${inputIndex}`}: {input.type}
        </Text>
      </label>
      <Input {...register(input.name || `arg${inputIndex}`)} />
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
          <form
            onSubmit={handleSubmit(async (args) => {
              try {
                setError(undefined);

                const data = await contract.call(abi.name, Object.values(args));
                setResult(`${data}`);
              } catch (err) {
                console.log(err);

                if (err instanceof Error) {
                  setError(err.message);
                  return;
                }

                setError("An unknown error occurred");
              }
            })}
            style={{ width: "100%" }}
          >
            <VStack spacing={4} alignItems="flex-start">
              {InputsForm}
              {error && (
                <Alert status="error">
                  <Code colorScheme="red" whiteSpace="pre" overflow="auto" width="100%">
                    {error}
                  </Code>
                </Alert>
              )}
              <Button type="submit" isLoading={formState.isLoading}>
                Run
              </Button>
              <Box width="100%">
                <Text as="small">Result:</Text>
                <Box backgroundColor="gray.100" width="100%" minHeight="100px" border="1px solid #ccc" overflowY="scroll">
                  {result !== "" && <Code p={4}>{result}</Code>}
                </Box>
              </Box>
            </VStack>
          </form>
        )}
      </AccordionPanel>
    </AccordionItem>
  );
}
