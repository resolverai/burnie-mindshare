'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  ArrowLeft,
  Search,
  Building2,
  CheckCircle,
  XCircle,
  Clock,
  AlertCircle,
  RefreshCw,
  Plus,
  ChevronDown,
  Trash2,
  X,
  Image as ImageIcon,
  Video,
  ExternalLink,
  ThumbsUp,
  ThumbsDown,
  Sparkles,
  Pencil,
} from 'lucide-react';

interface CountrySelection {
  code: string;
  name: string;
}

/** Meta Ads Library country codes (ISO 3166-1 alpha-2). EU = fetch from all 27 EU countries, merged. */
const META_ADS_COUNTRIES: CountrySelection[] = [
  { code: 'EU', name: 'European Union (all 27 EU countries)' },
  { code: 'US', name: 'United States' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'CA', name: 'Canada' },
  { code: 'AU', name: 'Australia' },
  { code: 'DE', name: 'Germany' },
  { code: 'FR', name: 'France' },
  { code: 'IN', name: 'India' },
  { code: 'BR', name: 'Brazil' },
  { code: 'MX', name: 'Mexico' },
  { code: 'ES', name: 'Spain' },
  { code: 'IT', name: 'Italy' },
  { code: 'NL', name: 'Netherlands' },
  { code: 'PL', name: 'Poland' },
  { code: 'BE', name: 'Belgium' },
  { code: 'AT', name: 'Austria' },
  { code: 'CH', name: 'Switzerland' },
  { code: 'SE', name: 'Sweden' },
  { code: 'NO', name: 'Norway' },
  { code: 'DK', name: 'Denmark' },
  { code: 'FI', name: 'Finland' },
  { code: 'IE', name: 'Ireland' },
  { code: 'PT', name: 'Portugal' },
  { code: 'GR', name: 'Greece' },
  { code: 'CZ', name: 'Czech Republic' },
  { code: 'RO', name: 'Romania' },
  { code: 'HU', name: 'Hungary' },
  { code: 'SG', name: 'Singapore' },
  { code: 'MY', name: 'Malaysia' },
  { code: 'PH', name: 'Philippines' },
  { code: 'ID', name: 'Indonesia' },
  { code: 'TH', name: 'Thailand' },
  { code: 'VN', name: 'Vietnam' },
  { code: 'JP', name: 'Japan' },
  { code: 'KR', name: 'South Korea' },
  { code: 'ZA', name: 'South Africa' },
  { code: 'AE', name: 'United Arab Emirates' },
  { code: 'SA', name: 'Saudi Arabia' },
  { code: 'IL', name: 'Israel' },
  { code: 'TR', name: 'Turkey' },
  { code: 'AR', name: 'Argentina' },
  { code: 'CL', name: 'Chile' },
  { code: 'CO', name: 'Colombia' },
  { code: 'NZ', name: 'New Zealand' },
].sort((a, b) => a.name.localeCompare(b.name));

interface DvybBrand {
  id: number;
  brandName: string;
  brandDomain: string;
  facebookHandle?: string | null;
  facebookPageId?: string | null;
  source: 'user' | 'admin';
  approvalStatus: 'approved' | 'pending_approval';
  countries: CountrySelection[] | null;
  fetchStatus: 'pending' | 'fetching' | 'completed' | 'failed';
  fetchError: string | null;
  lastAdsFetchedAt: string | null;
  createdAt: string;
  updatedAt: string;
  adCount?: number;
  approvedAdCount?: number;
  inventoryAnalysedCount?: number;
}

interface DvybBrandAd {
  id: number;
  metaAdId: string;
  platform?: string;
  approvalStatus?: 'approved' | 'pending_approval';
  creativeImageUrl: string | null;
  creativeVideoUrl: string | null;
  mediaType: 'image' | 'video';
  brandName: string;
  adSnapshotUrl: string | null;
  landingPage: string | null;
  adCopy: Record<string, unknown> | null;
  createdAt: string;
}

interface AdsPagination {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

function getPlatformLabel(platform: string | undefined): string {
  const p = (platform || 'meta').toLowerCase();
  if (p === 'instagram') return 'View on Instagram';
  if (p === 'facebook') return 'View on Facebook';
  if (p === 'google') return 'View on Google';
  if (p === 'youtube') return 'View on YouTube';
  if (p === 'tiktok') return 'View on TikTok';
  return 'View in Meta';
}

/** Meta Ad Library URL for this ad. Always use the safe library URL (no access token). */
function getAdMetaUrl(ad: DvybBrandAd): string | null {
  const id = ad.metaAdId?.trim() || String(ad.id).trim();
  if (id && id !== '0') return `https://www.facebook.com/ads/library/?id=${id}`;
  const url = ad.adSnapshotUrl?.trim();
  if (url && !url.includes('access_token')) return url;
  return null;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

interface Stats {
  totalFetching: number;
  totalCompleted: number;
  totalFailed: number;
  totalApprovedAds?: number;
  totalInventoryAnalysed?: number;
}

interface ApiResponse {
  success: boolean;
  data: DvybBrand[];
  pagination: Pagination;
  stats: Stats;
}

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

function getAuthHeaders(): HeadersInit {
  const token = typeof window !== 'undefined' ? localStorage.getItem('adminToken') : null;
  return {
    'Content-Type': 'application/json',
    ...(token && { Authorization: `Bearer ${token}` }),
  };
}

export default function DvybBrandsPage() {
  const router = useRouter();
  const [brands, setBrands] = useState<DvybBrand[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 20, total: 0, pages: 0 });
  const [stats, setStats] = useState<Stats>({
    totalFetching: 0,
    totalCompleted: 0,
    totalFailed: 0,
    totalApprovedAds: 0,
    totalInventoryAnalysed: 0,
  });
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [approvalFilter, setApprovalFilter] = useState('ALL');
  const [showAddModal, setShowAddModal] = useState(false);
  const [addBrandName, setAddBrandName] = useState('');
  const [addBrandDomain, setAddBrandDomain] = useState('');
  const [addFacebookHandle, setAddFacebookHandle] = useState('');
  const [addFacebookPageId, setAddFacebookPageId] = useState('');
  const [addMedia, setAddMedia] = useState<'image' | 'video' | 'both'>('image');
  const [addCountries, setAddCountries] = useState<CountrySelection[]>([]);
  const [countryDropdownOpen, setCountryDropdownOpen] = useState(false);
  const [countrySearchQuery, setCountrySearchQuery] = useState('');
  const countryDropdownRef = useRef<HTMLDivElement>(null);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState('');
  const [refetching, setRefetching] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [deleteConfirmBrand, setDeleteConfirmBrand] = useState<DvybBrand | null>(null);
  const [editBrand, setEditBrand] = useState<DvybBrand | null>(null);
  const [editBrandName, setEditBrandName] = useState('');
  const [editBrandDomain, setEditBrandDomain] = useState('');
  const [editFacebookHandle, setEditFacebookHandle] = useState('');
  const [editFacebookPageId, setEditFacebookPageId] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');
  const [refetchModalBrand, setRefetchModalBrand] = useState<DvybBrand | null>(null);
  const [refetchMedia, setRefetchMedia] = useState<'image' | 'video' | 'both'>('image');
  const [refetchCountries, setRefetchCountries] = useState<CountrySelection[]>([]);
  const [refetchCountryDropdownOpen, setRefetchCountryDropdownOpen] = useState(false);
  const [refetchCountrySearchQuery, setRefetchCountrySearchQuery] = useState('');
  const refetchCountryDropdownRef = useRef<HTMLDivElement>(null);
  const [showAdsModal, setShowAdsModal] = useState(false);
  const [selectedBrand, setSelectedBrand] = useState<DvybBrand | null>(null);
  const [ads, setAds] = useState<DvybBrandAd[]>([]);
  const [adsLoading, setAdsLoading] = useState(false);
  const [adsPagination, setAdsPagination] = useState<AdsPagination>({ page: 1, limit: 12, total: 0, pages: 0 });
  const [adsApprovalFilter, setAdsApprovalFilter] = useState<'all' | 'approved' | 'pending_approval'>('all');
  const [adsApproving, setAdsApproving] = useState<number | null>(null);
  const [runningInventoryAnalysis, setRunningInventoryAnalysis] = useState(false);
  const [runningInventoryAnalysisForBrand, setRunningInventoryAnalysisForBrand] = useState<number | null>(null);

  const fetchBrands = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
        ...(searchTerm && { search: searchTerm }),
        ...(statusFilter !== 'ALL' && { status: statusFilter.toLowerCase() }),
      });

      const response = await fetch(`${API_BASE}/api/admin/dvyb-brands?${params}`, {
        headers: getAuthHeaders(),
      });
      const data: ApiResponse = await response.json();

      if (data.success) {
        setBrands(data.data);
        setPagination(data.pagination);
        if (data.stats) {
          setStats(data.stats);
        }
      } else if (response.status === 401) {
        router.push('/admin');
      }
    } catch (error) {
      console.error('Error fetching brands:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const token = localStorage.getItem('adminToken');
    if (!token) {
      router.push('/admin');
      return;
    }
    fetchBrands();
  }, [pagination.page, searchTerm, statusFilter, approvalFilter]);

  const toggleCountry = (country: CountrySelection) => {
    setAddCountries((prev) =>
      prev.some((c) => c.code === country.code)
        ? prev.filter((c) => c.code !== country.code)
        : [...prev, country]
    );
  };

  const toggleRefetchCountry = (country: CountrySelection) => {
    setRefetchCountries((prev) =>
      prev.some((c) => c.code === country.code)
        ? prev.filter((c) => c.code !== country.code)
        : [...prev, country]
    );
  };

  const removeRefetchCountry = (idx: number) => {
    setRefetchCountries((prev) => prev.filter((_, i) => i !== idx));
  };

  const filteredCountries = META_ADS_COUNTRIES.filter(
    (c) =>
      c.name.toLowerCase().includes(countrySearchQuery.toLowerCase()) ||
      c.code.toLowerCase().includes(countrySearchQuery.toLowerCase())
  );

  const filteredRefetchCountries = META_ADS_COUNTRIES.filter(
    (c) =>
      c.name.toLowerCase().includes(refetchCountrySearchQuery.toLowerCase()) ||
      c.code.toLowerCase().includes(refetchCountrySearchQuery.toLowerCase())
  );

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (countryDropdownRef.current && !countryDropdownRef.current.contains(e.target as Node)) {
        setCountryDropdownOpen(false);
      }
    };
    if (countryDropdownOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [countryDropdownOpen]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (refetchCountryDropdownRef.current && !refetchCountryDropdownRef.current.contains(e.target as Node)) {
        setRefetchCountryDropdownOpen(false);
      }
    };
    if (refetchCountryDropdownOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [refetchCountryDropdownOpen]);

  const removeCountry = (idx: number) => {
    setAddCountries((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleDeleteBrand = async (brand: DvybBrand) => {
    try {
      setDeleting(brand.id);
      const response = await fetch(`${API_BASE}/api/admin/dvyb-brands/${brand.id}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      const data = await response.json();
      if (data.success) {
        setDeleteConfirmBrand(null);
        fetchBrands();
      } else {
        alert(data.error || 'Failed to delete brand');
      }
    } catch (error) {
      console.error('Error deleting brand:', error);
      alert('Failed to delete brand');
    } finally {
      setDeleting(null);
    }
  };

  const handleAddBrand = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addBrandDomain.trim()) {
      setAddError('Brand domain is required');
      return;
    }
    try {
      setAdding(true);
      setAddError('');
      const response = await fetch(`${API_BASE}/api/admin/dvyb-brands`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          brandName: addBrandName.trim(),
          brandDomain: addBrandDomain.trim(),
          facebookHandle: addFacebookHandle.trim() || null,
          facebookPageId: addFacebookPageId.trim() || null,
          countries: addCountries.length > 0 ? addCountries : null,
          media: addMedia,
        }),
      });
      const data = await response.json();

      if (data.success) {
        setShowAddModal(false);
        setAddBrandName('');
        setAddBrandDomain('');
        setAddFacebookHandle('');
        setAddFacebookPageId('');
        setAddMedia('image');
        fetchBrands();
        alert(data.data?.message || 'Brand added. Fetch started.');
      } else {
        setAddError(data.error || 'Failed to add brand');
      }
    } catch (error) {
      console.error('Error adding brand:', error);
      setAddError('Failed to add brand');
    } finally {
      setAdding(false);
    }
  };

  const handleApprove = async (brand: DvybBrand) => {
    try {
      setRefetching(brand.id);
      const response = await fetch(`${API_BASE}/api/admin/dvyb-brands/${brand.id}/approve`, {
        method: 'POST',
        headers: getAuthHeaders(),
      });
      const data = await response.json();
      if (data.success) {
        fetchBrands();
        alert(data.data?.message || 'Brand approved. Fetch started.');
      } else {
        alert(data.error || 'Failed to approve');
      }
    } catch (error) {
      console.error('Error approving:', error);
      alert('Failed to approve');
    } finally {
      setRefetching(null);
    }
  };

  const openEditModal = (brand: DvybBrand) => {
    setEditBrand(brand);
    setEditBrandName(brand.brandName || '');
    setEditBrandDomain(brand.brandDomain || '');
    setEditFacebookHandle(brand.facebookHandle ?? '');
    setEditFacebookPageId(brand.facebookPageId ?? '');
    setEditError('');
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editBrand) return;
    if (!editBrandDomain.trim()) {
      setEditError('Domain is required');
      return;
    }
    try {
      setEditSaving(true);
      setEditError('');
      const response = await fetch(`${API_BASE}/api/admin/dvyb-brands/${editBrand.id}`, {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          brandName: editBrandName.trim(),
          brandDomain: editBrandDomain.trim(),
          facebookHandle: editFacebookHandle.trim() || null,
          facebookPageId: editFacebookPageId.trim() || null,
        }),
      });
      const data = await response.json();
      if (data.success) {
        setEditBrand(null);
        fetchBrands();
        alert('Brand updated.');
      } else {
        setEditError(data.error || 'Failed to update brand');
      }
    } catch (error) {
      console.error('Error updating brand:', error);
      setEditError('Failed to update brand');
    } finally {
      setEditSaving(false);
    }
  };

  const openRefetchModal = (brand: DvybBrand) => {
    setRefetchModalBrand(brand);
    setRefetchMedia('image');
    setRefetchCountries((brand.countries as CountrySelection[]) ?? []);
    setRefetchCountrySearchQuery('');
  };

  const handleRunInventoryAnalysis = async (brandId?: number) => {
    try {
      if (brandId) {
        setRunningInventoryAnalysisForBrand(brandId);
      } else {
        setRunningInventoryAnalysis(true);
      }
      const url = brandId
        ? `${API_BASE}/api/admin/dvyb-brands/${brandId}/run-inventory-analysis`
        : `${API_BASE}/api/admin/dvyb-brands/run-inventory-analysis`;
      const response = await fetch(url, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: brandId ? undefined : JSON.stringify({}),
      });
      const data = await response.json();
      if (data.success) {
        const msg = data.data?.message || `Updated ${data.data?.updated ?? 0} ad(s)`;
        alert(msg);
        fetchBrands();
        if (selectedBrand) fetchAdsForModal(selectedBrand.id, adsPagination.page, adsApprovalFilter);
      } else {
        alert(data.error || 'Failed to run inventory analysis');
      }
    } catch (error) {
      console.error('Error running inventory analysis:', error);
      alert('Failed to run inventory analysis');
    } finally {
      if (brandId) {
        setRunningInventoryAnalysisForBrand(null);
      } else {
        setRunningInventoryAnalysis(false);
      }
    }
  };

  const handleRefetch = async () => {
    if (!refetchModalBrand) return;
    const brand = refetchModalBrand;
    try {
      setRefetching(brand.id);
      const response = await fetch(`${API_BASE}/api/admin/dvyb-brands`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          brandId: brand.id,
          brandName: brand.brandName,
          brandDomain: brand.brandDomain,
          countries: refetchCountries.length > 0 ? refetchCountries : null,
          media: refetchMedia,
        }),
      });
      const data = await response.json();
      if (data.success) {
        setRefetchModalBrand(null);
        fetchBrands();
        alert(data.data?.message || 'Re-fetch started.');
      } else {
        alert(data.error || 'Failed to re-fetch');
      }
    } catch (error) {
      console.error('Error re-fetching:', error);
      alert('Failed to re-fetch');
    } finally {
      setRefetching(null);
    }
  };

  const fetchAdsForModal = async (brandId: number, page: number = 1, approvalFilter: string = 'all') => {
    setAdsLoading(true);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: '12',
        ...(approvalFilter !== 'all' && { approvalFilter }),
      });
      const response = await fetch(
        `${API_BASE}/api/admin/dvyb-brands/${brandId}/ads?${params}`,
        { headers: getAuthHeaders() }
      );
      const data = await response.json();
      if (data.success) {
        setAds(data.data.ads || []);
        setAdsPagination(data.data.pagination || { page: 1, limit: 12, total: 0, pages: 0 });
      }
    } catch (error) {
      console.error('Error fetching ads:', error);
    } finally {
      setAdsLoading(false);
    }
  };

  const openAdsModal = async (brand: DvybBrand) => {
    setSelectedBrand(brand);
    setShowAdsModal(true);
    setAdsApprovalFilter('all');
    setAdsPagination({ page: 1, limit: 12, total: 0, pages: 0 });
    await fetchAdsForModal(brand.id, 1, 'all');
  };

  const handleAdApproval = async (ad: DvybBrandAd, approved: boolean) => {
    if (!selectedBrand) return;
    const newStatus = approved ? 'approved' : 'pending_approval';
    try {
      setAdsApproving(ad.id);
      const response = await fetch(
        `${API_BASE}/api/admin/dvyb-brands/${selectedBrand.id}/ads/${ad.id}/approval`,
        {
          method: 'PATCH',
          headers: getAuthHeaders(),
          body: JSON.stringify({ approved }),
        }
      );
      const data = await response.json();
      if (data.success) {
        setAds((prev) =>
          prev.map((a) => (a.id === ad.id ? { ...a, approvalStatus: newStatus } : a))
        );
      } else {
        alert(data.error || 'Failed to update approval');
      }
    } catch (error) {
      console.error('Error updating ad approval:', error);
      alert('Failed to update approval');
    } finally {
      setAdsApproving(null);
    }
  };

  const statusBadge = (status: DvybBrand['fetchStatus']) => {
    switch (status) {
      case 'pending':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
            <Clock className="h-3 w-3 mr-1" />
            Pending
          </span>
        );
      case 'fetching':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
            <RefreshCw className="h-3 w-3 mr-1 animate-spin" />
            Fetching
          </span>
        );
      case 'completed':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
            <CheckCircle className="h-3 w-3 mr-1" />
            Completed
          </span>
        );
      case 'failed':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
            <AlertCircle className="h-3 w-3 mr-1" />
            Failed
          </span>
        );
      default:
        return null;
    }
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
              <h1 className="text-3xl font-bold text-gray-900">DVYB Brands</h1>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={() => handleRunInventoryAnalysis()}
                disabled={runningInventoryAnalysis}
                variant="outline"
                className="flex items-center gap-2 border-sky-600 text-sky-600 hover:bg-sky-50"
              >
                {runningInventoryAnalysis ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                Run Inventory Analysis
              </Button>
              <Button
                onClick={() => setShowAddModal(true)}
                className="flex items-center gap-2 bg-sky-600 hover:bg-sky-700 text-white"
              >
                <Plus className="h-4 w-4" />
                Add Brand
              </Button>
            </div>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-6">
            <div className="bg-white rounded-lg shadow p-4 border-l-4 border-amber-500">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Fetching</p>
                  <p className="text-2xl font-bold text-gray-900">{stats.totalFetching}</p>
                </div>
                <RefreshCw className="h-8 w-8 text-amber-500" />
              </div>
            </div>
            <div className="bg-white rounded-lg shadow p-4 border-l-4 border-green-500">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Completed</p>
                  <p className="text-2xl font-bold text-gray-900">{stats.totalCompleted}</p>
                </div>
                <CheckCircle className="h-8 w-8 text-green-500" />
              </div>
            </div>
            <div className="bg-white rounded-lg shadow p-4 border-l-4 border-red-500">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Failed</p>
                  <p className="text-2xl font-bold text-gray-900">{stats.totalFailed}</p>
                </div>
                <XCircle className="h-8 w-8 text-red-500" />
              </div>
            </div>
            <div className="bg-white rounded-lg shadow p-4 border-l-4 border-sky-500">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Approved Ads</p>
                  <p className="text-2xl font-bold text-gray-900">{stats.totalApprovedAds ?? 0}</p>
                </div>
                <ThumbsUp className="h-8 w-8 text-sky-500" />
              </div>
            </div>
            <div className="bg-white rounded-lg shadow p-4 border-l-4 border-purple-500">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Inventory analysed</p>
                  <p className="text-2xl font-bold text-gray-900">{stats.totalInventoryAnalysed ?? 0}</p>
                </div>
                <Sparkles className="h-8 w-8 text-purple-500" />
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
                  placeholder="Search by brand name or domain..."
                  value={searchTerm}
                  onChange={(e) => {
                    setSearchTerm(e.target.value);
                    setPagination((p) => ({ ...p, page: 1 }));
                  }}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-sky-500 focus:border-transparent text-gray-900"
                />
              </div>
              <select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setPagination((p) => ({ ...p, page: 1 }));
                }}
                className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-sky-500 focus:border-transparent bg-white text-gray-900"
              >
                <option value="ALL">All Status</option>
                <option value="PENDING">Pending</option>
                <option value="FETCHING">Fetching</option>
                <option value="COMPLETED">Completed</option>
                <option value="FAILED">Failed</option>
              </select>
            </div>
          </div>
        </div>

        {/* Brands Table */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-sky-600"></div>
            </div>
          ) : brands.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-gray-500">
              <Building2 className="h-16 w-16 mb-4 opacity-50" />
              <p className="text-lg font-medium">No brands found</p>
              <p className="text-sm">Add a brand to fetch ads from Meta Ad Library</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Brand
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Source
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Approval
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Ads (Approved)
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Inventory Analysed
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Last Fetched
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {brands.map((brand) => (
                    <tr key={brand.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4">
                        <div>
                          <div className="text-sm font-medium text-gray-900">{brand.brandName}</div>
                          <div className="text-sm text-gray-500">{brand.brandDomain}</div>
                          {brand.fetchError && (
                            <div className="text-xs text-red-600 mt-1 truncate max-w-[200px]" title={brand.fetchError}>
                              {brand.fetchError}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="text-sm text-gray-600 capitalize">{brand.source}</span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {brand.approvalStatus === 'pending_approval' ? (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                            Pending
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                            Approved
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="text-sm font-medium text-gray-900">
                          {brand.adCount ?? 0} ({brand.approvedAdCount ?? 0} approved)
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span
                          className={`text-sm font-medium ${
                            (brand.inventoryAnalysedCount ?? 0) === (brand.approvedAdCount ?? 0) &&
                            (brand.approvedAdCount ?? 0) > 0
                              ? 'text-green-600'
                              : 'text-gray-600'
                          }`}
                          title={
                            (brand.inventoryAnalysedCount ?? 0) < (brand.approvedAdCount ?? 0)
                              ? `Run Inventory Analysis to analyse remaining ${(brand.approvedAdCount ?? 0) - (brand.inventoryAnalysedCount ?? 0)} ad(s)`
                              : undefined
                          }
                        >
                          {brand.inventoryAnalysedCount ?? 0} / {brand.approvedAdCount ?? 0}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">{statusBadge(brand.fetchStatus)}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {brand.lastAdsFetchedAt
                          ? new Date(brand.lastAdsFetchedAt).toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric',
                            })
                          : '—'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        <div className="flex items-center gap-1.5 flex-nowrap">
                          {brand.approvalStatus === 'pending_approval' && (
                            <Button
                              onClick={() => handleApprove(brand)}
                              disabled={refetching === brand.id}
                              size="sm"
                              variant="outline"
                              className="flex items-center gap-1 text-green-600 border-green-300 hover:bg-green-50 text-xs px-2 py-1 h-7"
                            >
                              {refetching === brand.id ? (
                                <RefreshCw className="h-3 w-3 animate-spin" />
                              ) : (
                                'Approve'
                              )}
                            </Button>
                          )}
                          <Button
                            onClick={() => openAdsModal(brand)}
                            size="sm"
                            variant="outline"
                            className="flex items-center gap-1 text-sky-600 border-sky-300 hover:bg-sky-50 text-xs px-2 py-1 h-7"
                          >
                            View Ads
                          </Button>
                          <Button
                            onClick={() => openEditModal(brand)}
                            size="sm"
                            variant="outline"
                            className="flex items-center gap-1 text-gray-700 border-gray-300 hover:bg-gray-50 text-xs px-2 py-1 h-7"
                          >
                            <Pencil className="h-3 w-3" />
                            Edit
                          </Button>
                          <Button
                            onClick={() => openRefetchModal(brand)}
                            disabled={refetching === brand.id || brand.fetchStatus === 'fetching'}
                            size="sm"
                            variant="outline"
                            className="flex items-center gap-1 text-amber-600 border-amber-300 hover:bg-amber-50 text-xs px-2 py-1 h-7"
                          >
                            {refetching === brand.id ? (
                              <RefreshCw className="h-3 w-3 animate-spin" />
                            ) : (
                              <RefreshCw className="h-3 w-3" />
                            )}
                            Re-fetch
                          </Button>
                          <Button
                            onClick={() => setDeleteConfirmBrand(brand)}
                            size="sm"
                            variant="outline"
                            title="Delete"
                            className="flex items-center justify-center text-red-600 border-red-300 hover:bg-red-50 text-xs px-2 py-1 h-7 w-7 min-w-7"
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
                  onClick={() => setPagination((p) => ({ ...p, page: Math.max(1, p.page - 1) }))}
                  disabled={pagination.page === 1}
                  variant="outline"
                  size="sm"
                  className="text-gray-900"
                >
                  Previous
                </Button>
                <Button
                  onClick={() => setPagination((p) => ({ ...p, page: Math.min(p.pages, p.page + 1) }))}
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
                    <span className="font-medium">{(pagination.page - 1) * pagination.limit + 1}</span> to{' '}
                    <span className="font-medium">
                      {Math.min(pagination.page * pagination.limit, pagination.total)}
                    </span>{' '}
                    of <span className="font-medium">{pagination.total}</span> brands
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={() => setPagination((p) => ({ ...p, page: Math.max(1, p.page - 1) }))}
                    disabled={pagination.page === 1}
                    variant="outline"
                    size="sm"
                    className="text-gray-900"
                  >
                    Previous
                  </Button>
                  <Button
                    onClick={() => setPagination((p) => ({ ...p, page: Math.min(p.pages, p.page + 1) }))}
                    disabled={pagination.page === pagination.pages}
                    variant="outline"
                    size="sm"
                    className="text-gray-900"
                  >
                    Next
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Add Brand Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-lg max-w-2xl w-full min-w-0 my-8 min-h-[32rem] flex flex-col">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-xl font-bold text-gray-900">Add Brand</h2>
              <p className="text-sm text-gray-600 mt-1">
                Enter domain and Facebook handle to fetch ads from Meta Ad Library
              </p>
            </div>
            <form
              onSubmit={handleAddBrand}
              className="p-6 space-y-4 flex-1 overflow-y-auto"
            >
              {addError && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                  <p className="text-sm text-red-800">{addError}</p>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Domain *</label>
                <input
                  type="text"
                  value={addBrandDomain}
                  onChange={(e) => setAddBrandDomain(e.target.value)}
                  placeholder="e.g. nike.com"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-sky-500 focus:border-transparent text-gray-900"
                  required
                />
                <p className="text-xs text-gray-500 mt-1">Enter domain without https:// (stored on brand and ads)</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Facebook handle</label>
                <input
                  type="text"
                  value={addFacebookHandle}
                  onChange={(e) => setAddFacebookHandle(e.target.value)}
                  placeholder="e.g. nike or @nike"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-sky-500 focus:border-transparent text-gray-900"
                />
                <p className="text-xs text-gray-500 mt-1">Used for Meta Ads Library search. Optional.</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Facebook Page ID (optional)</label>
                <input
                  type="text"
                  value={addFacebookPageId}
                  onChange={(e) => setAddFacebookPageId(e.target.value)}
                  placeholder="e.g. 416263825086751"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-sky-500 focus:border-transparent text-gray-900"
                />
                <p className="text-xs text-gray-500 mt-1">Search @handle on Meta Ads Library, then copy the number from the URL (view_all_page_id=...) to fetch only that page&apos;s ads.</p>
              </div>
              <div className="min-w-0" ref={countryDropdownRef}>
                <label className="block text-sm font-medium text-gray-700 mb-2">Countries</label>
                <p className="text-xs text-gray-500 mb-2">Select countries to fetch ads from (Meta Ads Library codes). Empty = All.</p>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setCountryDropdownOpen((o) => !o)}
                    className="w-full flex items-center justify-between gap-2 px-3 py-2 mb-2 border border-gray-300 rounded-lg bg-white text-left text-gray-900 hover:border-gray-400 focus:ring-2 focus:ring-sky-500 focus:border-transparent"
                  >
                    <span className="truncate">
                      {addCountries.length === 0
                        ? 'Select countries...'
                        : `${addCountries.length} selected`}
                    </span>
                    <ChevronDown
                      className={`h-4 w-4 shrink-0 text-gray-500 transition-transform ${countryDropdownOpen ? 'rotate-180' : ''}`}
                    />
                  </button>
                  {countryDropdownOpen && (
                    <div className="absolute z-50 w-full mt-0.5 rounded-lg border border-gray-200 bg-white shadow-lg overflow-hidden">
                      <div className="p-2 border-b border-gray-100">
                        <div className="relative">
                          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                          <input
                            type="text"
                            placeholder="Search countries..."
                            value={countrySearchQuery}
                            onChange={(e) => setCountrySearchQuery(e.target.value)}
                            className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-md text-sm text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-sky-500"
                          />
                        </div>
                      </div>
                      <div className="max-h-64 overflow-y-auto p-1">
                        {filteredCountries.length === 0 ? (
                          <p className="px-3 py-4 text-sm text-gray-500 text-center">No countries match</p>
                        ) : (
                          filteredCountries.map((c) => {
                            const isSelected = addCountries.some((x) => x.code === c.code);
                            return (
                              <label
                                key={c.code}
                                className="flex items-center gap-2 px-3 py-2 rounded cursor-pointer hover:bg-gray-50 text-sm text-gray-900"
                              >
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => toggleCountry(c)}
                                  className="rounded border-gray-300 text-sky-600 focus:ring-sky-500"
                                />
                                {c.name} ({c.code})
                              </label>
                            );
                          })
                        )}
                      </div>
                    </div>
                  )}
                </div>
                {addCountries.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {addCountries.map((c, i) => (
                      <span
                        key={c.code}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded bg-gray-100 text-gray-800 text-sm"
                      >
                        {c.name} ({c.code})
                        <button type="button" onClick={() => removeCountry(i)} className="text-red-600 hover:text-red-800 ml-0.5">
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Creative media type</label>
                <p className="text-xs text-gray-500 mb-2">Fetch image ads, video ads, or both.</p>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="addMedia"
                      value="image"
                      checked={addMedia === 'image'}
                      onChange={() => setAddMedia('image')}
                      className="text-sky-600 focus:ring-sky-500"
                    />
                    <ImageIcon className="h-4 w-4 text-gray-500" />
                    <span className="text-sm text-gray-900">Image</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="addMedia"
                      value="video"
                      checked={addMedia === 'video'}
                      onChange={() => setAddMedia('video')}
                      className="text-sky-600 focus:ring-sky-500"
                    />
                    <Video className="h-4 w-4 text-gray-500" />
                    <span className="text-sm text-gray-900">Video</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="addMedia"
                      value="both"
                      checked={addMedia === 'both'}
                      onChange={() => setAddMedia('both')}
                      className="text-sky-600 focus:ring-sky-500"
                    />
                    <ImageIcon className="h-4 w-4 text-gray-500" />
                    <Video className="h-4 w-4 text-gray-500" />
                    <span className="text-sm text-gray-900">Both</span>
                  </label>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Brand Name (optional)</label>
                <input
                  type="text"
                  value={addBrandName}
                  onChange={(e) => setAddBrandName(e.target.value)}
                  placeholder="e.g. Nike"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-sky-500 focus:border-transparent text-gray-900"
                />
              </div>
              <div className="flex gap-3 pt-2">
                <Button
                  type="button"
                  onClick={() => {
                    setShowAddModal(false);
                    setAddError('');
                    setAddBrandName('');
                    setAddBrandDomain('');
                    setAddFacebookHandle('');
                    setAddFacebookPageId('');
                    setAddMedia('image');
                    setAddCountries([]);
                    setCountrySearchQuery('');
                  }}
                  variant="outline"
                  className="flex-1 text-gray-900 border-gray-300 hover:bg-gray-50"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={adding}
                  className="flex-1 bg-sky-600 hover:bg-sky-700 text-white disabled:opacity-50"
                >
                  {adding ? 'Adding...' : 'Add & Fetch Ads'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Brand modal */}
      {editBrand && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-lg max-w-2xl w-full min-w-0 my-8 p-6">
            <h2 className="text-xl font-bold text-gray-900">Edit brand</h2>
            <p className="text-sm text-gray-600 mt-1 mb-4">
              Update domain, Facebook handle, or Facebook Page ID. Re-fetch uses Page ID first, then handle, then domain.
            </p>
            <form onSubmit={handleSaveEdit} className="space-y-4">
              {editError && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                  <p className="text-sm text-red-800">{editError}</p>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Brand name</label>
                <input
                  type="text"
                  value={editBrandName}
                  onChange={(e) => setEditBrandName(e.target.value)}
                  placeholder="e.g. Mejuri"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-sky-500 focus:border-transparent text-gray-900"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Domain *</label>
                <input
                  type="text"
                  value={editBrandDomain}
                  onChange={(e) => setEditBrandDomain(e.target.value)}
                  placeholder="e.g. mejuri.com"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-sky-500 focus:border-transparent text-gray-900"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Facebook handle</label>
                <input
                  type="text"
                  value={editFacebookHandle}
                  onChange={(e) => setEditFacebookHandle(e.target.value)}
                  placeholder="e.g. mejuri or @mejuri"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-sky-500 focus:border-transparent text-gray-900"
                />
                <p className="text-xs text-gray-500 mt-1">Used for Meta Ads Library search when Page ID is not set.</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Facebook Page ID</label>
                <input
                  type="text"
                  value={editFacebookPageId}
                  onChange={(e) => setEditFacebookPageId(e.target.value)}
                  placeholder="e.g. 416263825086751 (view_all_page_id from Ads Library URL)"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-sky-500 focus:border-transparent text-gray-900"
                />
                <p className="text-xs text-gray-500 mt-1">Re-fetch uses this first for brand-only ads. Copy from Ads Library URL after searching @handle.</p>
              </div>
              <div className="flex gap-3 pt-2">
                <Button
                  type="button"
                  onClick={() => { setEditBrand(null); setEditError(''); }}
                  variant="outline"
                  className="flex-1 border-gray-300 hover:bg-gray-50 text-gray-900"
                  disabled={editSaving}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={editSaving}
                  className="flex-1 bg-sky-600 hover:bg-sky-700 text-white disabled:opacity-50"
                >
                  {editSaving ? 'Saving...' : 'Save'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Refetch modal */}
      {refetchModalBrand && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-md w-full p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold text-gray-900 mb-2">Re-fetch ads</h2>
            <p className="text-sm text-gray-600 mb-4">
              Re-fetch ads for <strong>{refetchModalBrand.brandName || refetchModalBrand.brandDomain}</strong>. Choose countries and creatives:
            </p>
            <div className="min-w-0 mb-4" ref={refetchCountryDropdownRef}>
              <label className="block text-sm font-medium text-gray-700 mb-2">Countries</label>
              <p className="text-xs text-gray-500 mb-2">Select countries to fetch ads from. Empty = All.</p>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setRefetchCountryDropdownOpen((o) => !o)}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2 mb-2 border border-gray-300 rounded-lg bg-white text-left text-gray-900 hover:border-gray-400 focus:ring-2 focus:ring-sky-500 focus:border-transparent"
                >
                  <span className="truncate">
                    {refetchCountries.length === 0
                      ? 'Select countries...'
                      : `${refetchCountries.length} selected`}
                  </span>
                  <ChevronDown
                    className={`h-4 w-4 shrink-0 text-gray-500 transition-transform ${refetchCountryDropdownOpen ? 'rotate-180' : ''}`}
                  />
                </button>
                {refetchCountryDropdownOpen && (
                  <div className="absolute z-50 w-full mt-0.5 rounded-lg border border-gray-200 bg-white shadow-lg overflow-hidden">
                    <div className="p-2 border-b border-gray-100">
                      <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                        <input
                          type="text"
                          placeholder="Search countries..."
                          value={refetchCountrySearchQuery}
                          onChange={(e) => setRefetchCountrySearchQuery(e.target.value)}
                          className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-md text-sm text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-sky-500"
                        />
                      </div>
                    </div>
                    <div className="max-h-48 overflow-y-auto p-1">
                      {filteredRefetchCountries.length === 0 ? (
                        <p className="px-3 py-4 text-sm text-gray-500 text-center">No countries match</p>
                      ) : (
                        filteredRefetchCountries.map((c) => {
                          const isSelected = refetchCountries.some((x) => x.code === c.code);
                          return (
                            <label
                              key={c.code}
                              className="flex items-center gap-2 px-3 py-2 rounded cursor-pointer hover:bg-gray-50 text-sm text-gray-900"
                            >
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleRefetchCountry(c)}
                                className="rounded border-gray-300 text-sky-600 focus:ring-sky-500"
                              />
                              {c.name} ({c.code})
                            </label>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>
              {refetchCountries.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {refetchCountries.map((c, i) => (
                    <span
                      key={c.code}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded bg-gray-100 text-gray-800 text-sm"
                    >
                      {c.name} ({c.code})
                      <button
                        type="button"
                        onClick={() => removeRefetchCountry(i)}
                        className="text-red-600 hover:text-red-800 ml-0.5"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="mb-2">
              <label className="block text-sm font-medium text-gray-700 mb-2">Creative media type</label>
            </div>
            <div className="flex gap-4 mb-6">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="refetchMedia"
                  value="image"
                  checked={refetchMedia === 'image'}
                  onChange={() => setRefetchMedia('image')}
                  className="text-sky-600 focus:ring-sky-500"
                />
                <ImageIcon className="h-4 w-4 text-gray-500" />
                <span className="text-sm text-gray-900">Image</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="refetchMedia"
                  value="video"
                  checked={refetchMedia === 'video'}
                  onChange={() => setRefetchMedia('video')}
                  className="text-sky-600 focus:ring-sky-500"
                />
                <Video className="h-4 w-4 text-gray-500" />
                <span className="text-sm text-gray-900">Video</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="refetchMedia"
                  value="both"
                  checked={refetchMedia === 'both'}
                  onChange={() => setRefetchMedia('both')}
                  className="text-sky-600 focus:ring-sky-500"
                />
                <ImageIcon className="h-4 w-4 text-gray-500" />
                <Video className="h-4 w-4 text-gray-500" />
                <span className="text-sm text-gray-900">Both</span>
              </label>
            </div>
            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1 text-gray-900 border-gray-300 hover:bg-gray-50"
                onClick={() => setRefetchModalBrand(null)}
                disabled={refetching !== null}
              >
                Cancel
              </Button>
              <Button
                className="flex-1 bg-sky-600 hover:bg-sky-700 text-white disabled:opacity-50"
                onClick={handleRefetch}
                disabled={refetching !== null}
              >
                {refetching === refetchModalBrand.id ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin mr-2" />
                    Refetching...
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Refetch
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
      {deleteConfirmBrand && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-md w-full p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-2">Delete brand?</h2>
            <p className="text-sm text-gray-600 mb-4">
              This will permanently delete <strong>{deleteConfirmBrand.brandName || deleteConfirmBrand.brandDomain}</strong> and all {deleteConfirmBrand.adCount ?? 0} associated ads. This cannot be undone.
            </p>
            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1 text-gray-900 border-gray-300 hover:bg-gray-50"
                onClick={() => setDeleteConfirmBrand(null)}
                disabled={deleting !== null}
              >
                Cancel
              </Button>
              <Button
                variant="outline"
                className="flex-1 text-red-600 border-red-300 hover:bg-red-50"
                onClick={() => handleDeleteBrand(deleteConfirmBrand)}
                disabled={deleting !== null}
              >
                {deleting === deleteConfirmBrand.id ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin mr-2" />
                    Deleting...
                  </>
                ) : (
                  <>
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Ads Modal */}
      {showAdsModal && selectedBrand && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            <div className="p-6 border-b border-gray-200 flex items-center justify-between relative">
              <div>
                <h2 className="text-xl font-bold text-gray-900">{selectedBrand.brandName} — Ads</h2>
                <p className="text-sm text-gray-500">{selectedBrand.brandDomain}</p>
              </div>
              <button
                type="button"
                onClick={() => setShowAdsModal(false)}
                className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-red-500 text-white hover:bg-red-600 transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
                aria-label="Close modal"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="px-6 py-3 border-b border-gray-200 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm font-medium text-gray-700">Filter:</span>
                <div className="flex gap-2">
                {(['all', 'approved', 'pending_approval'] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => {
                      setAdsApprovalFilter(f);
                      fetchAdsForModal(selectedBrand.id, 1, f);
                    }}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      adsApprovalFilter === f
                        ? 'bg-sky-600 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {f === 'all' ? 'All' : f === 'approved' ? 'Approved' : 'Pending'}
                  </button>
                ))}
              </div>
              </div>
              <Button
                onClick={() => handleRunInventoryAnalysis(selectedBrand.id)}
                disabled={runningInventoryAnalysisForBrand === selectedBrand.id}
                variant="outline"
                size="sm"
                className="flex items-center gap-2 border-sky-600 text-sky-600 hover:bg-sky-50"
              >
                {runningInventoryAnalysisForBrand === selectedBrand.id ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                Run Inventory Analysis
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              {adsLoading ? (
                <div className="flex items-center justify-center h-32">
                  <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-sky-600"></div>
                </div>
              ) : ads.length === 0 ? (
                <p className="text-gray-500 text-center py-8">No ads found for this brand.</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {ads.map((ad) => (
                    <div
                      key={ad.id}
                      className="border border-gray-200 rounded-lg overflow-hidden bg-gray-50 hover:shadow-md transition-shadow"
                    >
                      <div className="aspect-square relative bg-gray-200">
                        {ad.mediaType === 'video' && ad.creativeVideoUrl ? (
                          <video
                            src={ad.creativeVideoUrl}
                            className="w-full h-full object-cover"
                            controls
                            muted
                            playsInline
                          />
                        ) : ad.creativeImageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={ad.creativeImageUrl}
                            alt={ad.brandName}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-gray-400">
                            {ad.mediaType === 'video' ? (
                              <Video className="h-12 w-12" />
                            ) : (
                              <ImageIcon className="h-12 w-12" />
                            )}
                          </div>
                        )}
                        <div className="absolute top-2 right-2">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                              ad.approvalStatus === 'approved'
                                ? 'bg-green-100 text-green-800'
                                : 'bg-amber-100 text-amber-800'
                            }`}
                          >
                            {ad.approvalStatus === 'approved' ? 'Approved' : 'Pending'}
                          </span>
                        </div>
                      </div>
                      <div className="p-3">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs text-gray-500 capitalize">{ad.mediaType}</span>
                          {getAdMetaUrl(ad) && (
                            <a
                              href={getAdMetaUrl(ad)!}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-sky-600 hover:underline flex items-center gap-1"
                            >
                              <ExternalLink className="h-3 w-3" />
                              {getPlatformLabel(ad.platform)}
                            </a>
                          )}
                        </div>
                        <div className="flex gap-2 mt-2">
                          {ad.approvalStatus === 'approved' ? (
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-xs h-7 text-amber-600 border-amber-300 hover:bg-amber-50"
                              onClick={() => handleAdApproval(ad, false)}
                              disabled={adsApproving === ad.id}
                            >
                              {adsApproving === ad.id ? (
                                <RefreshCw className="h-3 w-3 animate-spin" />
                              ) : (
                                <>
                                  <ThumbsDown className="h-3 w-3 mr-1" />
                                  Unapprove
                                </>
                              )}
                            </Button>
                          ) : (
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-xs h-7 text-green-600 border-green-300 hover:bg-green-50"
                              onClick={() => handleAdApproval(ad, true)}
                              disabled={adsApproving === ad.id}
                            >
                              {adsApproving === ad.id ? (
                                <RefreshCw className="h-3 w-3 animate-spin" />
                              ) : (
                                <>
                                  <ThumbsUp className="h-3 w-3 mr-1" />
                                  Approve
                                </>
                              )}
                            </Button>
                          )}
                        </div>
                        {ad.adCopy?.bodies && Array.isArray(ad.adCopy.bodies) ? (
                          <p className="text-xs text-gray-600 mt-1 line-clamp-2">
                            {(ad.adCopy.bodies as string[])[0]}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {adsPagination.pages > 1 && (
              <div className="px-6 py-3 border-t border-gray-200 flex items-center justify-between">
                <p className="text-sm text-gray-600">
                  Page {adsPagination.page} of {adsPagination.pages} ({adsPagination.total} total)
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-black"
                    onClick={() =>
                      fetchAdsForModal(
                        selectedBrand!.id,
                        Math.max(1, adsPagination.page - 1),
                        adsApprovalFilter
                      )
                    }
                    disabled={adsPagination.page <= 1 || adsLoading}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-black"
                    onClick={() =>
                      fetchAdsForModal(
                        selectedBrand!.id,
                        Math.min(adsPagination.pages, adsPagination.page + 1),
                        adsApprovalFilter
                      )
                    }
                    disabled={adsPagination.page >= adsPagination.pages || adsLoading}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}