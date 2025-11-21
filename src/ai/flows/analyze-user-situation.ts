'use server';

/**
 * @fileOverview A flow that analyzes the user's situation and identifies key aspects.
 *
 * - analyzeUserSituation - A function that takes a user's description of their situation and returns a summary of the key aspects.
 * - AnalyzeUserSituationInput - The input type for the analyzeUserSituation function.
 * - AnalyzeUserSituationOutput - The return type for the analyzeUserSituation function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const AnalyzeUserSituationInputSchema = z.object({
  situation: z
    .string()
    .describe('A description of the user\'s current life, work, or business situation.'),
});
export type AnalyzeUserSituationInput = z.infer<typeof AnalyzeUserSituationInputSchema>;

const AnalyzeUserSituationOutputSchema = z.object({
  summary: z
    .string()
    .describe('A summary of the key aspects of the user\'s situation.'),
});
export type AnalyzeUserSituationOutput = z.infer<typeof AnalyzeUserSituationOutputSchema>;

export async function analyzeUserSituation(input: AnalyzeUserSituationInput): Promise<AnalyzeUserSituationOutput> {
  return analyzeUserSituationFlow(input);
}

const prompt = ai.definePrompt({
  name: 'analyzeUserSituationPrompt',
  input: {schema: AnalyzeUserSituationInputSchema},
  output: {schema: AnalyzeUserSituationOutputSchema},
  prompt: `You are an expert in analyzing user situations.

You will be given a description of the user\'s current life, work, or business situation.

Your task is to identify the key aspects of the situation and provide a concise summary. Your response must be in Russian.

Situation: {{{situation}}}`,
});

const analyzeUserSituationFlow = ai.defineFlow(
  {
    name: 'analyzeUserSituationFlow',
    inputSchema: AnalyzeUserSituationInputSchema,
    outputSchema: AnalyzeUserSituationOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);
