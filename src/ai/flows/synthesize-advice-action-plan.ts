'use server';

/**
 * @fileOverview This file contains the Genkit flow for synthesizing advice from multiple advisors into a single, actionable plan.
 *
 * - synthesizeAdviceIntoActionPlan - A function that synthesizes the advice from multiple advisors.
 * - SynthesizeAdviceIntoActionPlanInput - The input type for the synthesizeAdviceIntoActionPlan function.
 * - SynthesizeAdviceIntoActionPlanOutput - The return type for the synthesizeAdviceIntoActionPlan function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const SynthesizeAdviceIntoActionPlanInputSchema = z.object({
  navalAdvice: z.string().describe('The advice from Naval Ravikant.'),
  pieterAdvice: z.string().describe('The advice from Pieter Levels.'),
  garyVeeAdvice: z.string().describe('The advice from Gary Vaynerchuk.'),
  userSituation: z.string().describe('The user provided situation.'),
});
export type SynthesizeAdviceIntoActionPlanInput = z.infer<
  typeof SynthesizeAdviceIntoActionPlanInputSchema
>;

const SynthesizeAdviceIntoActionPlanOutputSchema = z.object({
  synthesizedActionPlan: z
    .string()
    .describe(
      'A synthesized action plan that combines the advice from all three advisors, highlighting areas of agreement and disagreement.'
    ),
});
export type SynthesizeAdviceIntoActionPlanOutput = z.infer<
  typeof SynthesizeAdviceIntoActionPlanOutputSchema
>;

export async function synthesizeAdviceIntoActionPlan(
  input: SynthesizeAdviceIntoActionPlanInput
): Promise<SynthesizeAdviceIntoActionPlanOutput> {
  return synthesizeAdviceIntoActionPlanFlow(input);
}

const synthesizeAdviceIntoActionPlanPrompt = ai.definePrompt({
  name: 'synthesizeAdviceIntoActionPlanPrompt',
  input: {schema: SynthesizeAdviceIntoActionPlanInputSchema},
  output: {schema: SynthesizeAdviceIntoActionPlanOutputSchema},
  prompt: `You are an AI assistant tasked with synthesizing advice from three different advisors into a single, actionable plan. Your response must be in Russian.

  Here is the user's situation:
  {{userSituation}}

  Here is the advice from Naval Ravikant:
  {{navalAdvice}}

  Here is the advice from Pieter Levels:
  {{pieterAdvice}}

  Here is the advice from Gary Vaynerchuk:
  {{garyVeeAdvice}}

  Synthesize their advice into a single, coherent action plan. Highlight areas where the advisors agree and disagree, and explain the reasoning behind their different perspectives. Make the action plan as specific and actionable as possible.
  `,
});

const synthesizeAdviceIntoActionPlanFlow = ai.defineFlow(
  {
    name: 'synthesizeAdviceIntoActionPlanFlow',
    inputSchema: SynthesizeAdviceIntoActionPlanInputSchema,
    outputSchema: SynthesizeAdviceIntoActionPlanOutputSchema,
  },
  async input => {
    const {output} = await synthesizeAdviceIntoActionPlanPrompt(input);
    return output!;
  }
);
