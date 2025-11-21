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

const SimulateAdvisorAdviceInputSchema = z.object({
  situationDescription: z.string().describe('The user-provided description of their situation.'),
  selectedAdvisors: z.array(z.enum(['NavalRavikant', 'PieterLevels', 'GaryVaynerchuk'])).describe('An array of selected advisor names.'),
});

export type SimulateAdvisorAdviceInput = z.infer<typeof SimulateAdvisorAdviceInputSchema>;

const SimulateAdvisorAdviceOutputSchema = z.object({
  advisorAdvices: z.array(
    z.object({
      advisorName: z.enum(['NavalRavikant', 'PieterLevels', 'GaryVaynerchuk']),
      advice: z.string(),
    })
  ),
  synthesis: z.string().describe('A synthesis of the advice from all advisors.'),
});

export type SimulateAdvisorAdviceOutput = z.infer<typeof SimulateAdvisorAdviceOutputSchema>;

export async function simulateAdvisorAdvice(input: SimulateAdvisorAdviceInput): Promise<SimulateAdvisorAdviceOutput> {
  return simulateAdvisorAdviceFlow(input);
}

export const advisorProfiles = {
  NavalRavikant: {
    name: 'Наваль Равикант',
    style: 'Philosophical, strategic, long-term thinking, analogies.',
    principles: 'Seek wealth, not money or status. Build specific knowledge. Leverage through code, media, and people. Read what you love. Free markets and individual responsibility.',
    tone: 'Calm, thoughtful, insightful',
  },
  PieterLevels: {
    name: 'Питер Левелс',
    style: 'Practical, tactical, concrete steps, execution focus.',
    principles: 'Build in public, ship fast, iterate quickly. Minimum viable product -> revenue -> scale. Automation and solo-entrepreneurship. Data-driven decisions. Bootstrap approach.',
    tone: 'Direct, technical, humorous',
  },
  GaryVaynerchuk: {
    name: 'Гэри Вайнерчук',
    style: 'Energetic, motivational, action-oriented, work ethic.',
    principles: 'Extreme execution. Document, don\'t create. Attention is the main currency. Self-awareness. Patience + aggression. Long-term brand building.',
    tone: 'Passionate, intense, realistic',
  },
};

const simulateAdvisorAdvicePrompt = ai.definePrompt({
  name: 'simulateAdvisorAdvicePrompt',
  input: {schema: z.object({
    situationDescription: z.string(),
    advisorDetails: z.array(z.object({
        name: z.string(),
        style: z.string(),
        principles: z.string(),
        tone: z.string(),
    })),
  })},
  output: {schema: SimulateAdvisorAdviceOutputSchema},
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
    const advisorDetails = input.selectedAdvisors.map(id => ({
        ...advisorProfiles[id],
    }));

    const {output} = await simulateAdvisorAdvicePrompt({ 
        situationDescription: input.situationDescription,
        advisorDetails,
    });
    
    if (!output) {
      throw new Error('AI model returned no output.');
    }
    
    // Filter out any potentially empty/null advice objects
    output.advisorAdvices = output.advisorAdvices?.filter(advice => advice && advice.advisorName && advice.advice) || [];

    return output;
  }
);
