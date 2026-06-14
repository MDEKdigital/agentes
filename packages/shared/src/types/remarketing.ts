export type RemarketingFlowStatus = 'active' | 'inactive';
export type RemarketingMessageType = 'text' | 'audio' | 'image';
export type RemarketingEnrollmentStatus = 'active' | 'completed' | 'cancelled';

export interface RemarketingFlow {
  id: string;
  organization_id: string;
  name: string;
  product_campaign: string;
  agent_id: string;
  instance_id: string;
  status: RemarketingFlowStatus;
  entry_silence_minutes: number;
  cancel_on_reply: boolean;
  cancel_on_resolved: boolean;
  cancel_on_opt_out: boolean;
  last_executed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RemarketingStep {
  id: string;
  flow_id: string;
  step_order: number;
  wait_minutes: number;
  message_type: RemarketingMessageType;
  message_content: string;
  is_active: boolean;
  created_at: string;
}

export interface RemarketingEnrollment {
  id: string;
  flow_id: string;
  conversation_id: string;
  organization_id: string;
  next_step_id: string | null;
  enrolled_at: string;
  last_step_sent_at: string | null;
  status: RemarketingEnrollmentStatus;
  cancel_reason: string | null;
  created_at: string;
  updated_at: string;
}
