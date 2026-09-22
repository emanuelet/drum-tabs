CREATE INDEX IF NOT EXISTS assignment_teacher_created_idx ON assignment(teacher_id, created_at DESC);
CREATE INDEX IF NOT EXISTS assignment_learner_created_idx ON assignment(learner_id, created_at DESC);
