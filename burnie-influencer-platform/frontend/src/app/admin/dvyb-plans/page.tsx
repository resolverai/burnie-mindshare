'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { 
  ArrowLeft, 
  Search, 
  Plus,
  CheckCircle,
  XCircle,
  DollarSign,
  Edit2,
  Trash2,
  Image as ImageIcon,
  Video,
  Gift,
  Tag,
  ToggleLeft,
  ToggleRight,
  Loader2
} from 'lucide-react';

interface PricingPlan {
  id: number;
  planName: string;
  description: string | null;
  monthlyPrice: number;
  annualPrice: number;
  monthlyImageLimit: number;
  monthlyVideoLimit: number;
  annualImageLimit: number;
  annualVideoLimit: number;
  extraImagePostPrice: number;
  extraVideoPostPrice: number;
  isActive: boolean;
  isFreeTrialPlan: boolean;
  isFreemium: boolean;
  freemiumTrialDays: number;
  planFlow: 'website_analysis' | 'product_photoshot';
  stripeProductId: string | null;
  stripeMonthlyPriceId: string | null;
  stripeAnnualPriceId: string | null;
  dealActive: boolean;
  dealMonthlyPrice: number | null;
  dealAnnualPrice: number | null;
  createdAt: string;
  updatedAt: string;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

interface ApiResponse {
  success: boolean;
  data: PricingPlan[];
  pagination: Pagination;
}

export default function DvybPlansPage() {
  const router = useRouter();
  const [plans, setPlans] = useState<PricingPlan[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 20, total: 0, pages: 0 });
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [showModal, setShowModal] = useState(false);
  const [editingPlan, setEditingPlan] = useState<PricingPlan | null>(null);
  const [formData, setFormData] = useState({
    planName: '',
    description: '',
    monthlyPrice: '',
    annualPrice: '',
    monthlyImageLimit: '',
    monthlyVideoLimit: '',
    annualImageLimit: '',
    annualVideoLimit: '',
    extraImagePostPrice: '',
    extraVideoPostPrice: '',
    isFreeTrialPlan: false,
    isFreemium: false,
    freemiumTrialDays: '7',
    planFlow: 'website_analysis' as 'website_analysis' | 'product_photoshot',
    stripeProductId: '',
    stripeMonthlyPriceId: '',
    stripeAnnualPriceId: '',
    createStripeProduct: true, // Auto-create Stripe product for new non-free plans
    dealActive: false,
    dealMonthlyPrice: '',
    dealAnnualPrice: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [togglingPlanId, setTogglingPlanId] = useState<number | null>(null);

  // Fetch plans
  const fetchPlans = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
        ...(searchTerm && { search: searchTerm }),
        ...(statusFilter !== 'ALL' && { status: statusFilter.toLowerCase() })
      });

      const response = await fetch(`/api/admin/dvyb-plans?${params}`);
      const data: ApiResponse = await response.json();

      if (data.success) {
        setPlans(data.data);
        setPagination(data.pagination);
      }
    } catch (error) {
      console.error('Error fetching plans:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPlans();
  }, [pagination.page, searchTerm, statusFilter]);

  // Open modal for creating/editing
  const openModal = (plan?: PricingPlan) => {
    if (plan) {
      setEditingPlan(plan);
      setFormData({
        planName: plan.planName,
        description: plan.description || '',
        monthlyPrice: plan.monthlyPrice.toString(),
        annualPrice: plan.annualPrice.toString(),
        monthlyImageLimit: plan.monthlyImageLimit.toString(),
        monthlyVideoLimit: plan.monthlyVideoLimit.toString(),
        annualImageLimit: plan.annualImageLimit.toString(),
        annualVideoLimit: plan.annualVideoLimit.toString(),
        extraImagePostPrice: plan.extraImagePostPrice.toString(),
        extraVideoPostPrice: plan.extraVideoPostPrice.toString(),
        isFreeTrialPlan: plan.isFreeTrialPlan,
        isFreemium: plan.isFreemium || false,
        freemiumTrialDays: (plan.freemiumTrialDays || 7).toString(),
        planFlow: plan.planFlow || 'website_analysis',
        stripeProductId: plan.stripeProductId || '',
        stripeMonthlyPriceId: plan.stripeMonthlyPriceId || '',
        stripeAnnualPriceId: plan.stripeAnnualPriceId || '',
        createStripeProduct: false, // Don't auto-create when editing existing plan
        dealActive: plan.dealActive || false,
        dealMonthlyPrice: plan.dealMonthlyPrice != null ? plan.dealMonthlyPrice.toString() : '',
        dealAnnualPrice: plan.dealAnnualPrice != null ? plan.dealAnnualPrice.toString() : '',
      });
    } else {
      setEditingPlan(null);
      setFormData({
        planName: '',
        description: '',
        monthlyPrice: '',
        annualPrice: '',
        monthlyImageLimit: '',
        monthlyVideoLimit: '',
        annualImageLimit: '',
        annualVideoLimit: '',
        extraImagePostPrice: '',
        extraVideoPostPrice: '',
        isFreeTrialPlan: false,
        isFreemium: false,
        freemiumTrialDays: '7',
        planFlow: 'website_analysis',
        stripeProductId: '',
        stripeMonthlyPriceId: '',
        stripeAnnualPriceId: '',
        createStripeProduct: true, // Auto-create Stripe product for new non-free plans
        dealActive: false,
        dealMonthlyPrice: '',
        dealAnnualPrice: '',
      });
    }
    setShowModal(true);
  };

  // Handle submit
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (formData.dealActive && (!formData.dealMonthlyPrice || !formData.dealAnnualPrice)) {
      alert('When deal is enabled, both deal monthly and annual prices are required.');
      return;
    }
    
    try {
      setSubmitting(true);
      const url = editingPlan 
        ? `/api/admin/dvyb-plans/${editingPlan.id}`
        : '/api/admin/dvyb-plans';
      
      const method = editingPlan ? 'PATCH' : 'POST';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planName: formData.planName,
          description: formData.description || null,
          monthlyPrice: parseFloat(formData.monthlyPrice),
          annualPrice: parseFloat(formData.annualPrice),
          monthlyImageLimit: parseInt(formData.monthlyImageLimit),
          monthlyVideoLimit: parseInt(formData.monthlyVideoLimit),
          annualImageLimit: parseInt(formData.annualImageLimit),
          annualVideoLimit: parseInt(formData.annualVideoLimit),
          extraImagePostPrice: parseFloat(formData.extraImagePostPrice),
          extraVideoPostPrice: parseFloat(formData.extraVideoPostPrice),
          isFreeTrialPlan: formData.isFreeTrialPlan,
          isFreemium: formData.isFreemium,
          freemiumTrialDays: parseInt(formData.freemiumTrialDays) || 7,
          planFlow: formData.planFlow,
          // Stripe fields
          stripeProductId: formData.stripeProductId || null,
          stripeMonthlyPriceId: formData.stripeMonthlyPriceId || null,
          stripeAnnualPriceId: formData.stripeAnnualPriceId || null,
          createStripeProduct: formData.createStripeProduct && !formData.isFreeTrialPlan,
          dealActive: formData.dealActive,
          dealMonthlyPrice: formData.dealActive && formData.dealMonthlyPrice ? parseFloat(formData.dealMonthlyPrice) : null,
          dealAnnualPrice: formData.dealActive && formData.dealAnnualPrice ? parseFloat(formData.dealAnnualPrice) : null,
        }),
      });

      const data = await response.json();
      
      if (data.success) {
        setShowModal(false);
        fetchPlans();
        alert(data.message);
      } else {
        alert(data.error);
      }
    } catch (error) {
      console.error('Error saving plan:', error);
      alert('Failed to save plan');
    } finally {
      setSubmitting(false);
    }
  };

  // Handle toggle status (activate/deactivate)
  const handleToggleStatus = async (plan: PricingPlan) => {
    const action = plan.isActive ? 'deactivate' : 'activate';
    if (!confirm(`Are you sure you want to ${action} "${plan.planName}"?${plan.isActive ? '\n\nExisting subscribers will keep their plan, but new users won\'t see this plan.' : ''}`)) return;

    try {
      setTogglingPlanId(plan.id);
      const response = await fetch(`/api/admin/dvyb-plans/${plan.id}/toggle-status`, {
        method: 'PATCH',
      });

      const data = await response.json();
      
      if (data.success) {
        fetchPlans();
      } else {
        alert(data.error);
      }
    } catch (error) {
      console.error('Error toggling plan status:', error);
      alert('Failed to update plan status');
    } finally {
      setTogglingPlanId(null);
    }
  };

  // Handle delete
  const handleDelete = async (planId: number) => {
    if (!confirm('Are you sure you want to delete this plan? This action cannot be undone.')) return;

    try {
      const response = await fetch(`/api/admin/dvyb-plans/${planId}`, {
        method: 'DELETE',
      });

      const data = await response.json();
      
      if (data.success) {
        fetchPlans();
        alert(data.message);
      } else {
        alert(data.error);
      }
    } catch (error) {
      console.error('Error deleting plan:', error);
      alert('Failed to delete plan');
    }
  };

  const formatCurrency = (amount: number | string) => {
    const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
    return `$${numAmount.toFixed(2)}`;
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => router.back()}
                className="flex items-center gap-2 text-gray-700 hover:text-gray-900 bg-gray-100 hover:bg-gray-200"
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </Button>
              <h1 className="text-3xl font-bold text-gray-900">DVYB Pricing Plans</h1>
            </div>
            <Button
              onClick={() => openModal()}
              className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 text-white"
            >
              <Plus className="h-4 w-4" />
              Create Plan
            </Button>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="bg-white rounded-lg shadow p-4 border-l-4 border-green-500">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Active Plans</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {plans.filter(p => p.isActive).length}
                  </p>
                </div>
                <CheckCircle className="h-8 w-8 text-green-500" />
              </div>
            </div>
            <div className="bg-white rounded-lg shadow p-4 border-l-4 border-red-500">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Inactive Plans</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {plans.filter(p => !p.isActive).length}
                  </p>
                </div>
                <XCircle className="h-8 w-8 text-red-500" />
              </div>
            </div>
            <div className="bg-white rounded-lg shadow p-4 border-l-4 border-blue-500">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Total Plans</p>
                  <p className="text-2xl font-bold text-gray-900">{pagination.total}</p>
                </div>
                <DollarSign className="h-8 w-8 text-blue-500" />
              </div>
            </div>
          </div>

          {/* Search and Filters */}
          <div className="bg-white rounded-lg shadow p-4 mb-6">
            <div className="flex flex-col md:flex-row gap-4">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search plans..."
                  value={searchTerm}
                  onChange={(e) => {
                    setSearchTerm(e.target.value);
                    setPagination({ ...pagination, page: 1 });
                  }}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-gray-900"
                />
              </div>
              <select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setPagination({ ...pagination, page: 1 });
                }}
                className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent bg-white text-gray-900"
              >
                <option value="ALL">All Status</option>
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
              </select>
            </div>
          </div>
        </div>

        {/* Plans Table */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600"></div>
            </div>
          ) : plans.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-gray-500">
              <DollarSign className="h-16 w-16 mb-4 opacity-50" />
              <p className="text-lg font-medium">No plans found</p>
              <p className="text-sm">Create your first pricing plan</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Plan
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Price
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Limits
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Overage Pricing
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Flow
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Stripe
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {plans.map((plan) => (
                    <tr key={plan.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4">
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <div className="text-sm font-medium text-gray-900">{plan.planName}</div>
                            {plan.isFreeTrialPlan && (
                              <span className="px-2 py-0.5 text-xs font-medium bg-green-100 text-green-800 rounded-full flex items-center gap-1">
                                <Gift className="h-3 w-3" />
                                Free Trial
                              </span>
                            )}
                            {plan.isFreemium && !plan.isFreeTrialPlan && (
                              <span className="px-2 py-0.5 text-xs font-medium bg-purple-100 text-purple-800 rounded-full">
                                Opt-Out Trial ({plan.freemiumTrialDays}d)
                              </span>
                            )}
                          </div>
                          {plan.description && (
                            <div className="text-sm text-gray-500">{plan.description}</div>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm font-bold text-gray-900">
                          {formatCurrency(plan.monthlyPrice)}/mo
                        </div>
                        <div className="text-sm text-gray-700">
                          {formatCurrency(plan.annualPrice)}/yr
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-xs text-gray-600 font-semibold mb-1">Monthly:</div>
                        <div className="text-sm text-gray-900 flex items-center gap-3">
                          <span className="flex items-center gap-1">
                            <ImageIcon className="h-4 w-4 text-gray-500" />
                            {plan.monthlyImageLimit}
                          </span>
                          <span className="flex items-center gap-1">
                            <Video className="h-4 w-4 text-gray-500" />
                            {plan.monthlyVideoLimit}
                          </span>
                        </div>
                        <div className="text-xs text-gray-600 font-semibold mt-2 mb-1">Annual:</div>
                        <div className="text-sm text-gray-900 flex items-center gap-3">
                          <span className="flex items-center gap-1">
                            <ImageIcon className="h-4 w-4 text-gray-500" />
                            {plan.annualImageLimit}
                          </span>
                          <span className="flex items-center gap-1">
                            <Video className="h-4 w-4 text-gray-500" />
                            {plan.annualVideoLimit}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-600">
                          +{formatCurrency(plan.extraImagePostPrice)} / image
                        </div>
                        <div className="text-sm text-gray-600">
                          +{formatCurrency(plan.extraVideoPostPrice)} / video
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            plan.isActive
                              ? 'bg-green-100 text-green-800'
                              : 'bg-red-100 text-red-800'
                          }`}
                        >
                          {plan.isActive ? (
                            <>
                              <CheckCircle className="h-3 w-3 mr-1" />
                              Active
                            </>
                          ) : (
                            <>
                              <XCircle className="h-3 w-3 mr-1" />
                              Inactive
                            </>
                          )}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            plan.planFlow === 'product_photoshot'
                              ? 'bg-pink-100 text-pink-800'
                              : 'bg-blue-100 text-blue-800'
                          }`}
                        >
                          {plan.planFlow === 'product_photoshot' ? 'Product Shots' : 'Website Analysis'}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {plan.isFreeTrialPlan ? (
                          <span className="text-xs text-gray-400 italic">N/A</span>
                        ) : plan.stripeProductId ? (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
                            <CheckCircle className="h-3 w-3 mr-1" />
                            Connected
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                            <XCircle className="h-3 w-3 mr-1" />
                            Not Connected
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        <div className="flex items-center gap-2">
                          <Button
                            onClick={() => openModal(plan)}
                            size="sm"
                            variant="outline"
                            className="flex items-center gap-1 text-gray-900 border-gray-300 hover:bg-gray-50"
                          >
                            <Edit2 className="h-3 w-3" />
                            Edit
                          </Button>
                          <Button
                            onClick={() => handleToggleStatus(plan)}
                            size="sm"
                            variant={plan.isActive ? "outline" : "default"}
                            disabled={togglingPlanId === plan.id}
                            className={`flex items-center gap-1 ${plan.isActive ? 'text-orange-600 border-orange-300 hover:bg-orange-50' : 'bg-green-600 hover:bg-green-700'}`}
                            title={plan.isActive ? 'Deactivate plan' : 'Activate plan'}
                          >
                            {togglingPlanId === plan.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : plan.isActive ? (
                              <ToggleRight className="h-3 w-3" />
                            ) : (
                              <ToggleLeft className="h-3 w-3" />
                            )}
                            {plan.isActive ? 'Deactivate' : 'Activate'}
                          </Button>
                          <Button
                            onClick={() => handleDelete(plan.id)}
                            size="sm"
                            variant="destructive"
                            className="flex items-center gap-1"
                            title="Delete plan permanently"
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {!loading && pagination.pages > 1 && (
            <div className="bg-white px-4 py-3 flex items-center justify-between border-t border-gray-200 sm:px-6">
              <div className="flex-1 flex justify-between sm:hidden">
                <Button
                  onClick={() => setPagination({ ...pagination, page: Math.max(1, pagination.page - 1) })}
                  disabled={pagination.page === 1}
                  variant="outline"
                  size="sm"
                  className="text-gray-900"
                >
                  Previous
                </Button>
                <Button
                  onClick={() => setPagination({ ...pagination, page: Math.min(pagination.pages, pagination.page + 1) })}
                  disabled={pagination.page === pagination.pages}
                  variant="outline"
                  size="sm"
                  className="text-gray-900"
                >
                  Next
                </Button>
              </div>
              <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm text-gray-700">
                    Showing{' '}
                    <span className="font-medium">
                      {(pagination.page - 1) * pagination.limit + 1}
                    </span>{' '}
                    to{' '}
                    <span className="font-medium">
                      {Math.min(pagination.page * pagination.limit, pagination.total)}
                    </span>{' '}
                    of{' '}
                    <span className="font-medium">{pagination.total}</span>{' '}
                    plans
                  </p>
                </div>
                <div>
                  <nav className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px">
                    <Button
                      onClick={() => setPagination({ ...pagination, page: Math.max(1, pagination.page - 1) })}
                      disabled={pagination.page === 1}
                      variant="outline"
                      size="sm"
                      className="rounded-l-md text-gray-900"
                    >
                      Previous
                    </Button>
                    <Button
                      onClick={() => setPagination({ ...pagination, page: Math.min(pagination.pages, pagination.page + 1) })}
                      disabled={pagination.page === pagination.pages}
                      variant="outline"
                      size="sm"
                      className="rounded-r-md text-gray-900"
                    >
                      Next
                    </Button>
                  </nav>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-xl font-bold text-gray-900">
                {editingPlan ? 'Edit Plan' : 'Create New Plan'}
              </h2>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Plan Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.planName}
                    onChange={(e) => setFormData({ ...formData, planName: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-gray-900"
                    placeholder="e.g., Free Trial, Pro, Enterprise"
                  />
                </div>

                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Description
                  </label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    rows={2}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-gray-900"
                    placeholder="Brief description of the plan"
                  />
                </div>

                {/* Pricing Section */}
                <div className="col-span-2">
                  <h3 className="text-md font-semibold text-gray-900 mb-3">Pricing</h3>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Monthly Price ($) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={formData.monthlyPrice}
                    onChange={(e) => setFormData({ ...formData, monthlyPrice: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-gray-900"
                    placeholder="0.00"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Annual Price ($) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={formData.annualPrice}
                    onChange={(e) => setFormData({ ...formData, annualPrice: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-gray-900"
                    placeholder="0.00"
                  />
                </div>

                {/* Deal / Promotional Pricing */}
                {!formData.isFreeTrialPlan && (
                  <div className="col-span-2 mt-4 p-4 bg-amber-50 border border-amber-200 rounded-lg">
                    <label className="flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formData.dealActive}
                        onChange={(e) => setFormData({ 
                          ...formData, 
                          dealActive: e.target.checked,
                          ...(e.target.checked ? {} : { dealMonthlyPrice: '', dealAnnualPrice: '' })
                        })}
                        className="w-4 h-4 text-amber-600 bg-gray-100 border-gray-300 rounded focus:ring-amber-500 focus:ring-2"
                      />
                      <span className="ml-2 text-sm font-medium text-gray-900 flex items-center gap-1">
                        <Tag className="h-4 w-4 text-amber-600" />
                        Enable Deal / Promotional Pricing
                      </span>
                    </label>
                    <p className="text-xs text-gray-500 mt-1 ml-6">
                      Show a discounted price to users. Original price above is used when deal is off. Stripe deal prices are auto-created on save when the plan has Stripe connected. When you turn off the deal, new checkouts use original price; existing subscribers are automatically switched to the original price at their next renewal.
                    </p>
                    {formData.dealActive && (
                      <div className="mt-4 ml-6 grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">
                            Deal Monthly Price ($) *
                          </label>
                          <input
                            type="number"
                            step="0.01"
                            required={formData.dealActive}
                            value={formData.dealMonthlyPrice}
                            onChange={(e) => setFormData({ ...formData, dealMonthlyPrice: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent text-gray-900"
                            placeholder="Deal price"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">
                            Deal Annual Price ($) *
                          </label>
                          <input
                            type="number"
                            step="0.01"
                            required={formData.dealActive}
                            value={formData.dealAnnualPrice}
                            onChange={(e) => setFormData({ ...formData, dealAnnualPrice: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent text-gray-900"
                            placeholder="Deal price"
                          />
                        </div>
                        {formData.monthlyPrice && formData.dealMonthlyPrice && parseFloat(formData.dealMonthlyPrice) < parseFloat(formData.monthlyPrice) && (
                          <div className="col-span-2 text-xs text-green-600">
                            Discount: ~{Math.round((1 - parseFloat(formData.dealMonthlyPrice) / parseFloat(formData.monthlyPrice)) * 100)}% off monthly
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Monthly Limits */}
                <div className="col-span-2 mt-4">
                  <h3 className="text-md font-semibold text-gray-900 mb-3">Monthly Limits</h3>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Monthly Image Posts *
                  </label>
                  <input
                    type="number"
                    required
                    value={formData.monthlyImageLimit}
                    onChange={(e) => setFormData({ ...formData, monthlyImageLimit: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-gray-900"
                    placeholder="0"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Monthly Video Posts *
                  </label>
                  <input
                    type="number"
                    required
                    value={formData.monthlyVideoLimit}
                    onChange={(e) => setFormData({ ...formData, monthlyVideoLimit: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-gray-900"
                    placeholder="0"
                  />
                </div>

                {/* Annual Limits */}
                <div className="col-span-2 mt-4">
                  <h3 className="text-md font-semibold text-gray-900 mb-3">Annual Limits</h3>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Annual Image Posts *
                  </label>
                  <input
                    type="number"
                    required
                    value={formData.annualImageLimit}
                    onChange={(e) => setFormData({ ...formData, annualImageLimit: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-gray-900"
                    placeholder="0"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Annual Video Posts *
                  </label>
                  <input
                    type="number"
                    required
                    value={formData.annualVideoLimit}
                    onChange={(e) => setFormData({ ...formData, annualVideoLimit: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-gray-900"
                    placeholder="0"
                  />
                </div>

                {/* Overage Pricing */}
                <div className="col-span-2 mt-4">
                  <h3 className="text-md font-semibold text-gray-900 mb-3">Overage Pricing</h3>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Extra Image Price ($) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={formData.extraImagePostPrice}
                    onChange={(e) => setFormData({ ...formData, extraImagePostPrice: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-gray-900"
                    placeholder="0.00"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Extra Video Price ($) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={formData.extraVideoPostPrice}
                    onChange={(e) => setFormData({ ...formData, extraVideoPostPrice: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-gray-900"
                    placeholder="0.00"
                  />
                </div>

                {/* Free Trial Flag */}
                <div className="col-span-2 mt-4">
                  <label className="flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.isFreeTrialPlan}
                      onChange={(e) => setFormData({ ...formData, isFreeTrialPlan: e.target.checked, isFreemium: false })}
                      className="w-4 h-4 text-purple-600 bg-gray-100 border-gray-300 rounded focus:ring-purple-500 focus:ring-2"
                    />
                    <span className="ml-2 text-sm font-medium text-gray-900 flex items-center gap-1">
                      <Gift className="h-4 w-4" />
                      This is a Free Trial Plan
                    </span>
                  </label>
                  <p className="text-xs text-gray-500 mt-1 ml-6">
                    If checked, this plan will be automatically assigned to all new accounts upon registration
                  </p>
                </div>

                {/* Opt-Out Free Trial Flag (only shown if not Free Trial Plan) */}
                {!formData.isFreeTrialPlan && (
                  <div className="col-span-2 mt-4 p-4 bg-purple-50 border border-purple-200 rounded-lg">
                    <label className="flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formData.isFreemium}
                        onChange={(e) => setFormData({ ...formData, isFreemium: e.target.checked })}
                        className="w-4 h-4 text-purple-600 bg-gray-100 border-gray-300 rounded focus:ring-purple-500 focus:ring-2"
                      />
                      <span className="ml-2 text-sm font-medium text-gray-900">
                        Enable Opt-Out Free Trial
                      </span>
                    </label>
                    <p className="text-xs text-gray-500 mt-1 ml-6">
                      Users provide payment method upfront, get a free trial period, then are charged automatically unless they cancel.
                      Trial is given only once per plan per user. If a user re-subscribes to the same plan, they are charged immediately (no second trial).
                    </p>
                    
                    {formData.isFreemium && (
                      <div className="mt-3 ml-6">
                        <label className="block text-xs font-medium text-gray-700 mb-1">
                          Trial Period (days)
                        </label>
                        <input
                          type="number"
                          min="1"
                          max="30"
                          value={formData.freemiumTrialDays}
                          onChange={(e) => setFormData({ ...formData, freemiumTrialDays: e.target.value })}
                          className="w-24 px-3 py-1.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-gray-900 text-sm"
                        />
                      </div>
                    )}
                  </div>
                )}

                {/* Plan Flow Selection */}
                <div className="col-span-2 mt-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Plan Flow / Product *
                  </label>
                  <select
                    value={formData.planFlow}
                    onChange={(e) => setFormData({ ...formData, planFlow: e.target.value as 'website_analysis' | 'product_photoshot' })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent bg-white text-gray-900"
                  >
                    <option value="website_analysis">Website Analysis Flow (Image Posts / Video Posts)</option>
                    <option value="product_photoshot">Product Shots Flow (Images / Videos)</option>
                  </select>
                  <p className="text-xs text-gray-500 mt-1">
                    Determines which user acquisition flow this plan belongs to. Users will only see plans matching their signup flow.
                  </p>
                </div>

                {/* Stripe Configuration Section */}
                <div className="col-span-2 border-t border-gray-200 pt-4 mt-4">
                  <h4 className="text-sm font-medium text-gray-900 mb-3 flex items-center gap-2">
                    <DollarSign className="h-4 w-4 text-purple-600" />
                    Stripe Configuration
                  </h4>
                  
                  {/* Auto-create Stripe Product (only for new plans) */}
                  {!editingPlan && !formData.isFreeTrialPlan && (
                    <div className="mb-4">
                      <label className="flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={formData.createStripeProduct}
                          onChange={(e) => setFormData({ ...formData, createStripeProduct: e.target.checked })}
                          className="w-4 h-4 text-purple-600 bg-gray-100 border-gray-300 rounded focus:ring-purple-500 focus:ring-2"
                        />
                        <span className="ml-2 text-sm font-medium text-gray-900">
                          Auto-create Stripe Product & Prices
                        </span>
                      </label>
                      <p className="text-xs text-gray-500 mt-1 ml-6">
                        Automatically creates a Stripe product with monthly and annual prices
                      </p>
                    </div>
                  )}

                  {/* Create Stripe Product button for existing plans without Stripe IDs */}
                  {editingPlan && !formData.stripeProductId && !formData.isFreeTrialPlan && (
                    <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                      <p className="text-sm text-yellow-800 mb-2">
                        This plan doesn&apos;t have Stripe integration yet.
                      </p>
                      <label className="flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={formData.createStripeProduct}
                          onChange={(e) => setFormData({ ...formData, createStripeProduct: e.target.checked })}
                          className="w-4 h-4 text-purple-600 bg-gray-100 border-gray-300 rounded focus:ring-purple-500 focus:ring-2"
                        />
                        <span className="ml-2 text-sm font-medium text-gray-900">
                          Create Stripe Product & Prices now
                        </span>
                      </label>
                    </div>
                  )}
                  
                  <div className="grid grid-cols-1 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">
                        Stripe Product ID
                      </label>
                      <input
                        type="text"
                        value={formData.stripeProductId}
                        onChange={(e) => setFormData({ ...formData, stripeProductId: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-gray-900 text-sm"
                        placeholder="prod_xxxxxxxxxx (optional, auto-created if enabled)"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">
                          Monthly Price ID
                        </label>
                        <input
                          type="text"
                          value={formData.stripeMonthlyPriceId}
                          onChange={(e) => setFormData({ ...formData, stripeMonthlyPriceId: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-gray-900 text-sm"
                          placeholder="price_xxxxxxxxxx"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">
                          Annual Price ID
                        </label>
                        <input
                          type="text"
                          value={formData.stripeAnnualPriceId}
                          onChange={(e) => setFormData({ ...formData, stripeAnnualPriceId: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-gray-900 text-sm"
                          placeholder="price_xxxxxxxxxx"
                        />
                      </div>
                    </div>
                  </div>
                  
                  {formData.isFreeTrialPlan && (
                    <p className="text-xs text-gray-500 mt-2 italic">
                      Stripe configuration not needed for free trial plans
                    </p>
                  )}
                </div>

              </div>

              <div className="flex gap-3 pt-4">
                <Button
                  type="button"
                  onClick={() => setShowModal(false)}
                  variant="outline"
                  className="flex-1 text-gray-900 border-gray-300 hover:bg-gray-50"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 bg-purple-600 hover:bg-purple-700 text-white"
                >
                  {submitting ? 'Saving...' : editingPlan ? 'Update Plan' : 'Create Plan'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

