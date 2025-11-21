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
    .describe('An array of selected advisor IDs (e.g., ["NavalRavikant", "SteveJobs"]).'),
});

export type SimulateAdvisorAdviceInput = z.infer<
  typeof SimulateAdvisorAdviceInputSchema
>;

const SimulateAdvisorAdviceOutputSchema = z.object({
  advisorAdvices: z.array(
    z.object({
      advisorId: z.string().describe("The ID of the advisor (e.g., NavalRavikant)."),
      advice: z.string().describe("The concise advice from this advisor (3-4 sentences)."),
    })
  ),
  synthesis: z.string().describe('A concise synthesis of the advice from all advisors (3-4 sentences).'),
});

export type SimulateAdvisorAdviceOutput = z.infer<
  typeof SimulateAdvisorAdviceOutputSchema
>;

export async function simulateAdvisorAdvice(
  input: SimulateAdvisorAdviceInput
): Promise<SimulateAdvisorAdviceOutput> {
  return simulateAdvisorAdviceFlow(input);
}

// FIX #3: Изменен output schema для прямого использования advisorId
const simulateAdvisorAdvicePrompt = ai.definePrompt({
  name: 'simulateAdvisorAdvicePrompt',
  input: {
    schema: z.object({
      situationDescription: z.string(),
      advisorDetails: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          style: z.string(),
          principles: z.string(),
          tone: z.string(),
        })
      ),
    }),
  },
  output: {schema: SimulateAdvisorAdviceOutputSchema},
  prompt: `You are a facilitator of a personal advisory board. You will provide advice from each of the selected advisors based on their known philosophies. Your response MUST be in Russian.

  The user's situation is:
  "{{situationDescription}}"

  Here are the advisor profiles you must use:
  {{#each advisorDetails}}
  - Advisor ID: {{this.id}}, Name: {{this.name}}, Style: {{this.style}}, Principles: {{this.principles}}, Tone: {{this.tone}}
  {{/each}}
  
  INSTRUCTIONS:
  1. For EACH advisor, provide their specific advice based on their profile. The advice for EACH advisor must be CONCISE (3-4 sentences).
  2. Then, provide a "synthesis": a short, actionable summary of all advice. The synthesis must also be CONCISE (3-4 sentences).
  3. CRITICAL: In the output JSON, the 'advisorId' field MUST be the exact ID string provided above (e.g., "NavalRavikant", "SteveJobs"). DO NOT use the advisor's name, use the ID.
  4. Return advice for ALL advisors provided in the list.

  Output the advice in the specified JSON format with advisorId (not name) for each advisor.
  `,
});

const simulateAdvisorAdviceFlow = ai.defineFlow(
  {
    name: 'simulateAdvisorAdviceFlow',
    inputSchema: SimulateAdvisorAdviceInputSchema,
    outputSchema: SimulateAdvisorAdviceOutputSchema,
  },
  async input => {
    // 1. Get profiles for the selected advisors.
    const advisorDetails = input.selectedAdvisors.map(id => {
      const profile = advisorProfiles[id as keyof typeof advisorProfiles];
      if (!profile) {
        throw new Error(`Advisor profile for ID "${id}" not found.`);
      }
      return {
        id,
        ...profile
      };
    });

    if (advisorDetails.length === 0) {
        throw new Error('No valid advisors were provided to the flow.');
    }

    // 2. Call the AI model with the prepared details.
    const {output} = await simulateAdvisorAdvicePrompt({
      situationDescription: input.situationDescription,
      advisorDetails: advisorDetails,
    });

    if (!output || !output.advisorAdvices) {
      throw new Error('AI model returned invalid or empty output.');
    }

    // FIX #3: Теперь не нужен маппинг - AI возвращает advisorId напрямую
    // Проверяем, что все ID валидны
    const validatedAdvices = output.advisorAdvices.filter(advice => {
      const isValid = input.selectedAdvisors.includes(advice.advisorId);
      if (!isValid) {
        console.warn(`AI returned unexpected advisor ID: "${advice.advisorId}"`);
      }
      return isValid;
    });

    if (validatedAdvices.length === 0) {
      throw new Error('AI model returned no valid advisor advices.');
    }

    // 4. Return the final output.
    return {
        synthesis: output.synthesis,
        advisorAdvices: validatedAdvices,
    };
  }
);
