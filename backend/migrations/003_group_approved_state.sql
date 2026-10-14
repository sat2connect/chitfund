-- Phase 3 extension: a group is Approved before enrolment is opened (opening is a separate, central-operations action).
alter table chit_groups drop constraint if exists chit_groups_status_check;
alter table chit_groups add constraint chit_groups_status_check
  check (status in ('DRAFT','APPROVAL_PENDING','APPROVED','ENROLMENT_OPEN','READY_TO_START','ACTIVE','SUSPENDED','COMPLETED','CLOSED'));
