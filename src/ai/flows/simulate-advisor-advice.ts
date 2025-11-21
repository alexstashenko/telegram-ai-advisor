'use server';

/**
 * @fileOverview Simulates advice from a selected advisory board based on their known philosophies and approaches.
 *
 * - simulateAdvisorAdvice - A function that simulates advice from selected advisors.
 * - SimulateAdvisorAdviceInput - The input type for the simulateAdvisorAdvice function.
 * - SimulateAdvisorAdviceOutput - The return type for the simulateAdvisorAdvice function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';
import {advisorProfiles} from '@/ai/advisors';

const SimulateAdvisorAdviceInputSchema = z.object({
  situationDescription: z
    .string()
    .describe('The user-provided description of their situation.'),
  selectedAdvisors: z
    .array(z.string())
    .describe('An array of selected advisor IDs.'),
});

export type SimulateAdvisorAdviceInput = z.infer<
  typeof SimulateAdvisorAdviceInputSchema
>;

const SimulateAdvisorAdviceOutputSchema = z.object({
  advisorAdvices: z.array(
    z.object({
      advisorId: z.string().describe("The ID of the advisor."),
      advice: z.string(),
    })
  ),
  synthesis: z.string().describe('A synthesis of the advice from all advisors.'),
});

export type SimulateAdvisorAdviceOutput = z.infer<
  typeof SimulateAdvisorAdviceOutputSchema
>;

export async function simulateAdvisorAdvice(
  input: SimulateAdvisorAdviceInput
): Promise<SimulateAdvisorAdviceOutput> {
  return simulateAdvisorAdviceFlow(input);
}

const simulateAdvisorAdvicePrompt = ai.definePrompt({
  name: 'simulateAdvisorAdvicePrompt',
  input: {
    schema: z.object({
      situationDescription: z.string(),
      advisorDetails: z.array(
        z.object({
          id: z.string(), // Important to have ID here for mapping
          name: z.string(),
          style: z.string(),
          principles: z.string(),
          tone: z.string(),
        })
      ),
    }),
  },
  output: {schema: z.object({
      advisorAdvices: z.array(
        z.object({
          advisorName: z.string().describe("The full name of the advisor."),
          advice: z.string(),
        })
      ),
      synthesis: z.string().describe('A synthesis of the advice from all advisors.'),
    })},
  prompt: `You are a facilitator of a personal advisory board. You will provide advice from each of the selected advisors based on their known philosophies. Your response MUST be in Russian.

  The user's situation is:
  "{{situationDescription}}"

  Here are the advisor profiles:
  {{#each advisorDetails}}
  - Advisor: {{this.name}} (Style: {{this.style}}, Principles: {{this.principles}}, Tone: {{this.tone}})
  {{/each}}
  
  INSTRUCTIONS:
  1. For EACH advisor, provide their specific advice based on their profile. The advice for EACH advisor must be CONCISE (3-4 sentences).
  2. Then, provide a "synthesis": a short, actionable summary of all advice. The synthesis must also be CONCISE (3-4 sentences).
  3. The 'advisorName' in the output JSON must be the original name string for that advisor.

  Output the advice in the specified JSON format.
  `,
});

const simulateAdvisorAdviceFlow = ai.defineFlow(
  {
    name: 'simulateAdvisorAdviceFlow',
    inputSchema: SimulateAdvisorAdviceInputSchema,
    outputSchema: SimulateAdvisorAdviceOutputSchema,
  },
  async input => {
    const advisorDetails = input.selectedAdvisors.map(id => {
      const profile = advisorProfiles[id as keyof typeof advisorProfiles];
      if (!profile) {
        throw new Error(`Advisor profile for ID "${id}" not found.`);
      }
      return {
        id, // pass the id through
        ...profile
      };
    });

    const {output: rawOutput} = await simulateAdvisorAdvicePrompt({
      situationDescription: input.situationDescription,
      advisorDetails: advisorDetails, // Pass details with ID
    });

    if (!rawOutput || !rawOutput.advisorAdvices) {
      throw new Error('AI model returned invalid output.');
    }

    // Map advisor names from the output back to the original IDs.
    const mappedAdvices = rawOutput.advisorAdvices.map(adviceItem => {
      const matchingAdvisor = advisorDetails.find(d => d.name === adviceItem.advisorName);
      if (!matchingAdvisor) {
        // This case is unlikely if the model follows instructions, but it's a good safeguard.
        console.warn(`Could not map advisor name "${adviceItem.advisorName}" back to an ID.`);
        return {
          advisorId: 'unknown',
          advice: adviceItem.advice,
        };
      }
      return {
        advisorId: matchingAdvisor.id, // The crucial mapping back to the ID
        advice: adviceItem.advice,
      };
    });

    return {
        synthesis: rawOutput.synthesis,
        advisorAdvices: mappedAdvices,
    };
  }
);
