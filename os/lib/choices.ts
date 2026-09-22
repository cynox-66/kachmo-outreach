/**
 * The choices an operator makes in the record forms, in their words, with the consequence of each (ADR-035).
 *
 * Pure constants shared by the server (which translates history and results with them) and the client forms (which
 * offer them). Deliberately outside `server/`: a client component may import from `server/` only 'use server' action
 * modules (tests/auth.ts), and these are neither secret nor server-side.
 *
 * Keys are core's own values; tests/operator.ts pins that every core value has an entry and no entry is invented.
 */

/** What each pipeline stage means, and what recording it does. FOLLOW_UP_SENT is Titan's and never offered. */
export const STAGE_CHOICES: Record<string, { label: string; consequence: string; needsChannel: boolean }> = {
  REPLIED_POSITIVE: { label: 'They replied — interested', consequence: 'Marks them as interested. Today will ask you to book a meeting.', needsChannel: true },
  REPLIED_NOT_NOW: { label: 'They replied — not now', consequence: 'Marks them as not ready yet. Nothing more is asked of you for now.', needsChannel: true },
  NOT_INTERESTED: { label: 'They are not interested', consequence: 'Marks them as not interested. It does not add them to the do-not-contact list.', needsChannel: true },
  MEETING_BOOKED: { label: 'A meeting is booked', consequence: 'Records the meeting. Add the date so it appears on Today.', needsChannel: true },
  MEETING_DONE: { label: 'The meeting happened', consequence: 'Records that you met. Next is usually a proposal.', needsChannel: false },
  PROPOSAL_SENT: { label: 'A proposal was sent', consequence: 'Records the proposal (needs a meeting first).', needsChannel: false },
  WON: { label: 'We won the work', consequence: 'Closes the deal as won (needs a proposal first). A closed deal cannot be reopened.', needsChannel: false },
  LOST: { label: 'We lost it', consequence: 'Closes the deal as lost. A closed deal cannot be reopened. Say why.', needsChannel: false },
};

export const CALL_OUTCOME_CHOICES: Record<string, { label: string; consequence: string; stop?: true }> = {
  NO_ANSWER: { label: 'No answer', consequence: 'Try again in two days. After three unanswered calls, calling stops.' },
  VOICEMAIL: { label: 'Left a voicemail', consequence: 'Counts as unanswered. Try again in two days.' },
  GATEKEEPER: { label: 'Spoke to someone else (gatekeeper)', consequence: 'Counts as unanswered. Try again in two days.' },
  WRONG_NUMBER: { label: 'Wrong number', consequence: 'Marks the number as wrong. The company goes back to research for the right one.' },
  CALLBACK: { label: 'They asked us to call back', consequence: 'Schedules the call-back (tomorrow unless you pick a date).' },
  INTERESTED: { label: 'Interested', consequence: 'Marks them interested; the follow-up you promised is due today.' },
  NOT_NOW: { label: 'Not now', consequence: 'Check in again in about two months (or on the date you pick).' },
  NOT_INTERESTED: { label: 'Not interested', consequence: 'Stops calling. It does not add them to the do-not-contact list.' },
  MEETING_BOOKED: { label: 'Booked a meeting', consequence: 'Records the meeting. Add the date.' },
  DO_NOT_CONTACT: { label: 'They asked us never to contact them', consequence: 'Adds them to the do-not-contact list on every channel — email, calls, WhatsApp. Only an owner can undo this.', stop: true },
};

export const WHATSAPP_CHOICES: Record<string, { label: string; consequence: string; stop?: true }> = {
  APPROVED: { label: 'Approve the draft', consequence: 'Marks the message approved. Nothing is sent — you send it from your phone, then record that here.' },
  REJECTED: { label: "Reject the draft — don't send it", consequence: 'The draft will not be sent.' },
  SENT: { label: 'I sent it from my phone', consequence: 'Records the send. No second unsolicited message; wait for a reply.' },
  REPLIED: { label: 'They replied', consequence: 'Records the reply. Answer them personally on WhatsApp today.' },
  OPT_OUT: { label: 'They asked us never to contact them', consequence: 'Adds them to the do-not-contact list on every channel. Only an owner can undo this.', stop: true },
};

/** The research a person can record, in plain words (core's RECORDABLE_FIELDS; keys tested). */
export const RESEARCH_CHOICES: Record<string, { label: string; valueLabel: string; needs: string }> = {
  'decision-maker': { label: 'Who the decision-maker is', valueLabel: 'Their name', needs: 'the page that shows them and their role' },
  email: { label: 'Their email address', valueLabel: 'Email address', needs: 'where it is published, or how you confirmed it' },
  phone: { label: 'Their phone number', valueLabel: 'Phone number', needs: 'where it is published, or how you confirmed it' },
  'commercial-source': { label: 'Proof they buy this kind of work', valueLabel: 'What you found (clients, projects, funding)', needs: 'the page that shows it' },
  'friction-source': { label: 'A website problem we can fix', valueLabel: 'What is wrong with their website', needs: 'the page you checked' },
  trigger: { label: 'A reason to act now', valueLabel: 'What happened (a launch, a hire, funding)', needs: 'a link, if there is one' },
  budget: { label: 'A budget signal', valueLabel: 'Very high, high, medium, low or unknown', needs: 'what the signal is' },
  tech: { label: 'Their website technology', valueLabel: 'CMS or framework', needs: 'how you know, if you can say' },
  'frontend-team': { label: 'Whether they have a frontend team', valueLabel: 'No team, small team, large team or unclear', needs: 'what shows it' },
  'whatsapp-basis': { label: 'Why WhatsApp is OK to use', valueLabel: 'Their WhatsApp is advertised, or they agreed on a call', needs: 'the page, or when they agreed' },
  timezone: { label: 'Their timezone', valueLabel: 'e.g. Europe/London', needs: '' },
  fit: { label: 'Kachmo fit decision (owners)', valueLabel: 'Confirmed or rejected', needs: 'why, if rejected' },
};
