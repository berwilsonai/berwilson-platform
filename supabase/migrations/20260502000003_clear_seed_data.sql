-- Clear all seed/mock data so real data can be entered.
-- TRUNCATE CASCADE handles FK dependencies and bypasses delete triggers.

truncate table
  ai_queries,
  research_artifacts,
  activity_log,
  review_queue,
  chunks,
  processed_emails,
  graph_subscriptions,
  email_tokens,
  compliance_items,
  dd_items,
  financing_structures,
  milestones,
  documents,
  updates,
  project_players,
  entity_projects,
  entities,
  parties,
  projects
restart identity cascade;
