import { Route, Routes } from 'react-router-dom';
import AppShell from '../components/layout/AppShell.jsx';
import DashboardPage from '../features/dashboard/DashboardPage.jsx';
import ModulePage from '../features/modules/ModulePage.jsx';
import AuditLogsPage from '../features/administration/AuditLogsPage.jsx';
import { CrmLayout } from '../features/crm/shared.jsx';
import LeadsPage from '../features/crm/LeadsPage.jsx';
import LeadFormPage from '../features/crm/LeadFormPage.jsx';
import LeadDetailPage from '../features/crm/LeadDetailPage.jsx';
import FollowUpsPage from '../features/crm/FollowUpsPage.jsx';
import CustomersPage from '../features/crm/CustomersPage.jsx';
import CustomerFormPage from '../features/crm/CustomerFormPage.jsx';
import CustomerProfilePage from '../features/crm/CustomerProfilePage.jsx';
import KycQueuePage, { KycLayout } from '../features/kyc/KycQueuePage.jsx';
import KycCasePage from '../features/kyc/KycCasePage.jsx';
import ApplicationsPage from '../features/kyc/ApplicationsPage.jsx';
import SchemesPage, { SchemesLayout } from '../features/schemes/SchemesPage.jsx';
import SchemeFormPage from '../features/schemes/SchemeFormPage.jsx';
import SchemeDetailPage from '../features/schemes/SchemeDetailPage.jsx';
import GroupsPage from '../features/schemes/GroupsPage.jsx';
import CalculationPreviewPage from '../features/schemes/CalculationPreviewPage.jsx';
import GroupFormPage from '../features/schemes/GroupFormPage.jsx';
import GroupDetailPage from '../features/schemes/GroupDetailPage.jsx';
import ApprovalsPage from '../features/approvals/ApprovalsPage.jsx';
import { CollectionsLayout } from '../features/collections/CollectionsLayout.jsx';
import DuesPage from '../features/collections/DuesPage.jsx';
import CollectPage from '../features/collections/CollectPage.jsx';
import PaymentsPage from '../features/collections/PaymentsPage.jsx';
import PaymentDetailPage from '../features/collections/PaymentDetailPage.jsx';
import AttemptsPage from '../features/collections/AttemptsPage.jsx';
import ArrearsPage from '../features/collections/ArrearsPage.jsx';
import ReconciliationPage from '../features/collections/ReconciliationPage.jsx';
import JournalsPage, { AccountingLayout } from '../features/accounting/JournalsPage.jsx';
import JournalFormPage from '../features/accounting/JournalFormPage.jsx';
import JournalDetailPage from '../features/accounting/JournalDetailPage.jsx';
import { LedgerPage, StatementsPage, TrialBalancePage } from '../features/accounting/ReportsPages.jsx';
import { AccountsPage, PeriodsPage } from '../features/accounting/ChartPages.jsx';
import AuctionsPage, { AuctionsLayout } from '../features/auctions/AuctionsPage.jsx';
import AuctionFormPage from '../features/auctions/AuctionFormPage.jsx';
import AuctionDetailPage from '../features/auctions/AuctionDetailPage.jsx';
import PayoutsPage, { PayoutsLayout } from '../features/payouts/PayoutsPage.jsx';
import PayoutFormPage from '../features/payouts/PayoutFormPage.jsx';
import PayoutDetailPage from '../features/payouts/PayoutDetailPage.jsx';
import PayoutReconPage from '../features/payouts/PayoutReconPage.jsx';
import PortalShell from '../components/layout/PortalShell.jsx';
import PortalHome from '../features/portal/PortalHome.jsx';
import { PortalInstalments, PortalPay, PortalPaymentDetail, PortalPayments, PortalPayouts, PortalStatement } from '../features/portal/PortalMoney.jsx';
import { PortalProfile, PortalSupportCase, PortalSupportList, PortalSupportNew } from '../features/portal/PortalSupport.jsx';
import { SupportCasePage, SupportCasesPage } from '../features/support/SupportPages.jsx';
import { useAuth } from './AuthContext.jsx';
import AdminLayout from '../features/administration/AdminLayout.jsx';
import UsersPage from '../features/administration/UsersPage.jsx';
import SignInPage from '../features/auth/SignInPage.jsx';
import { ActivatePage, ChangePasswordPage } from '../features/auth/AccountPages.jsx';
import { LoadingState, EmptyState } from '../components/feedback/States.jsx';
import { AuthProvider } from './AuthContext.jsx';
import { modules } from './routes.js';

const placeholders = modules.filter((m) => !['dashboard', 'crm', 'kyc', 'admin', 'schemes', 'approvals', 'collections', 'accounting', 'auctions', 'payouts', 'support'].includes(m.key));

// Members get the customer portal shell; everyone else gets the staff application shell.
function Shell() {
  const { user } = useAuth();
  return user?.customerId ? <PortalShell /> : <AppShell />;
}

/** In session mode nothing is shown until the user has signed in; activation is the only public page. */
function Gate({ children }) {
  const { mode, user, loading } = useAuth();
  if (mode === null || (mode === 'session' && loading)) return <div className="p-8"><LoadingState label="Loading…" /></div>;
  if (mode === 'session' && !user) {
    return (
      <Routes>
        <Route path="/activate" element={<ActivatePage />} />
        <Route path="*" element={<SignInPage />} />
      </Routes>
    );
  }
  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <Gate>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<DashboardPage />} />

          <Route path="/crm" element={<CrmLayout />}>
            <Route index element={<LeadsPage />} />
            <Route path="leads/new" element={<LeadFormPage />} />
            <Route path="leads/:id" element={<LeadDetailPage />} />
            <Route path="follow-ups" element={<FollowUpsPage />} />
            <Route path="customers" element={<CustomersPage />} />
            <Route path="customers/new" element={<CustomerFormPage />} />
            <Route path="customers/:id" element={<CustomerProfilePage />} />
          </Route>

          <Route path="/kyc" element={<KycLayout />}>
            <Route index element={<KycQueuePage />} />
            <Route path="cases/:id" element={<KycCasePage />} />
            <Route path="applications" element={<ApplicationsPage />} />
          </Route>

          <Route path="/schemes" element={<SchemesLayout />}>
            <Route index element={<SchemesPage />} />
            <Route path="new" element={<SchemeFormPage />} />
            <Route path=":schemeId/versions/:versionId/edit" element={<SchemeFormPage />} />
            <Route path=":id" element={<SchemeDetailPage />} />
            <Route path="calculations" element={<CalculationPreviewPage />} />
            <Route path="groups" element={<GroupsPage />} />
            <Route path="groups/new" element={<GroupFormPage />} />
            <Route path="groups/:id" element={<GroupDetailPage />} />
          </Route>

          <Route path="/collections" element={<CollectionsLayout />}>
            <Route index element={<DuesPage />} />
            <Route path="collect" element={<CollectPage />} />
            <Route path="payments" element={<PaymentsPage />} />
            <Route path="payments/:id" element={<PaymentDetailPage />} />
            <Route path="attempts" element={<AttemptsPage />} />
            <Route path="arrears" element={<ArrearsPage />} />
            <Route path="reconciliation" element={<ReconciliationPage />} />
          </Route>

          <Route path="/accounting" element={<AccountingLayout />}>
            <Route index element={<JournalsPage />} />
            <Route path="journals/new" element={<JournalFormPage />} />
            <Route path="journals/:id" element={<JournalDetailPage />} />
            <Route path="journals/:id/edit" element={<JournalFormPage />} />
            <Route path="ledger" element={<LedgerPage />} />
            <Route path="trial-balance" element={<TrialBalancePage />} />
            <Route path="statements" element={<StatementsPage />} />
            <Route path="accounts" element={<AccountsPage />} />
            <Route path="periods" element={<PeriodsPage />} />
          </Route>

          <Route path="/auctions" element={<AuctionsLayout />}>
            <Route index element={<AuctionsPage />} />
            <Route path="new" element={<AuctionFormPage />} />
            <Route path=":id" element={<AuctionDetailPage />} />
          </Route>

          <Route path="/payouts" element={<PayoutsLayout />}>
            <Route index element={<PayoutsPage />} />
            <Route path="new" element={<PayoutFormPage />} />
            <Route path="reconciliation" element={<PayoutReconPage />} />
            <Route path=":id" element={<PayoutDetailPage />} />
            <Route path=":id/edit" element={<PayoutFormPage />} />
          </Route>

          <Route path="/portal" element={<PortalHome />} />
          <Route path="/portal/instalments" element={<PortalInstalments />} />
          <Route path="/portal/pay" element={<PortalPay />} />
          <Route path="/portal/payments" element={<PortalPayments />} />
          <Route path="/portal/payments/:id" element={<PortalPaymentDetail />} />
          <Route path="/portal/statement" element={<PortalStatement />} />
          <Route path="/portal/payouts" element={<PortalPayouts />} />
          <Route path="/portal/support" element={<PortalSupportList />} />
          <Route path="/portal/support/new" element={<PortalSupportNew />} />
          <Route path="/portal/support/:id" element={<PortalSupportCase />} />
          <Route path="/portal/profile" element={<PortalProfile />} />

          <Route path="/support" element={<SupportCasesPage />} />
          <Route path="/support/:id" element={<SupportCasePage />} />
          <Route path="/approvals" element={<ApprovalsPage />} />

          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<AuditLogsPage />} />
            <Route path="users" element={<UsersPage />} />
          </Route>
          <Route path="/account/password" element={<ChangePasswordPage />} />

          {placeholders.map((m) => (
            <Route key={m.key} path={m.path} element={<ModulePage module={m} />} />
          ))}
          <Route path="*" element={<EmptyState title="Page not found" description="The page you requested does not exist." />} />
        </Route>
      </Routes>
      </Gate>
    </AuthProvider>
  );
}
