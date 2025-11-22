'use server';

/**
 * @fileOverview Simulates advice from a selected advisory board based on their profiles.
 *
 * - simulateAdvisorAdvice - A function that simulates advice from selected advisors.
 * - SimulateAdvisorAdviceInput - The input type for the simulateAdvisorAdvice function.
 * - SimulateAdvisorAdviceOutput - The return type for the simulateAdvisorAdvice function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';
import {AdvisorProfileSchema, type AdvisorProfile} from '@/ai/flows/select-advisors';

const SimulateAdvisorAdviceInputSchema = z.object({
  situationDescription: z
    .string()
    .describe('The user-provided description of their situation.'),
  selectedAdvisors: z
    .array(AdvisorProfileSchema)
    .describe('An array of selected advisor profiles.'),
});

export type SimulateAdvisorAdviceInput = z.infer<
  typeof SimulateAdvisorAdviceInputSchema
>;

const SimulateAdvisorAdviceOutputSchema = z.object({
  advisorAdvices: z.array(
    z.object({
      advisorId: z.string().describe("The ID of the advisor."),
      advice: z.string().describe("The concise advice from this advisor (2-3 sentences)."),
    })
  ),
  synthesis: z.string().describe('A concise synthesis of the advice from all advisors (2-3 sentences).'),
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
      advisorDetails: z.array(AdvisorProfileSchema),
    }),
  },
  output: {schema: SimulateAdvisorAdviceOutputSchema},
  prompt: `You are a facilitator of a personal advisory board. You will provide advice from each of the selected advisors based on their profiles. Your response MUST be in Russian.

  The user's situation is:
  "{{situationDescription}}"

  Here are the advisor profiles:
  {{#each advisorDetails}}
  - Advisor ID: {{this.id}}
  - Name: {{this.name}}
  - Style: {{this.style}}
  - Principles: {{this.principles}}
  - Tone: {{this.tone}}
  {{/each}}
  
  INSTRUCTIONS:
  1. For EACH advisor, provide their specific advice based on their profile. The advice for EACH advisor must be CONCISE (2-3 sentences).
  2. Embody their unique style, principles, and tone authentically.
  3. Then, provide a "synthesis": a short, actionable summary of all advice. The synthesis must also be CONCISE (2-3 sentences).
  4. CRITICAL: In the output JSON, the 'advisorId' field MUST be the exact ID string provided above.
  5. Return advice for ALL advisors provided in the list.

  Output the advice in the specified JSON format with advisorId for each advisor.
  `,
});

const simulateAdvisorAdviceFlow = ai.defineFlow(
  {
    name: 'simulateAdvisorAdviceFlow',
    inputSchema: SimulateAdvisorAdviceInputSchema,
    outputSchema: SimulateAdvisorAdviceOutputSchema,
  },
  async input => {
    if (input.selectedAdvisors.length === 0) {
        throw new Error('No advisors were provided to the flow.');
    }

    // Call the AI model with the advisor profiles
    const {output} = await simulateAdvisorAdvicePrompt({
      situationDescription: input.situationDescription,
      advisorDetails: input.selectedAdvisors,
    });

    if (!output || !output.advisorAdvices) {
      throw new Error('AI model returned invalid or empty output.');
    }

    // Validate that all IDs are correct
    const expectedIds = input.selectedAdvisors.map(a => a.id);
    const validatedAdvices = output.advisorAdvices.filter(advice => {
      const isValid = expectedIds.includes(advice.advisorId);
      if (!isValid) {
        console.warn(`AI returned unexpected advisor ID: "${advice.advisorId}"`);
      }
      return isValid;
    });

    if (validatedAdvices.length === 0) {
      throw new Error('AI model returned no valid advisor advices.');
    }

    return {
        synthesis: output.synthesis,
        advisorAdvices: validatedAdvices,
    };
  }
);

    
