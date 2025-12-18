'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { 
  ArrowLeft, Search, Plus, Trash2, ExternalLink, Youtube, Instagram, 
  Twitter, Music2, Filter, X, Check, ChevronDown, Loader2, Image, Video, Pencil
} from 'lucide-react';

// Custom hook for debounced value
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debouncedValue;
}

const PlatformIcon = ({ platform }: { platform: string }) => {
  const iconClass = "h-5 w-5";
  switch (platform.toLowerCase()) {
    case 'youtube': return <Youtube className={`${iconClass} text-red-500`} />;
    case 'instagram': return <Instagram className={`${iconClass} text-pink-500`} />;
    case 'twitter': return <Twitter className={`${iconClass} text-blue-400`} />;
    case 'tiktok': return <Music2 className={`${iconClass} text-black`} />;
    default: return <ExternalLink className={iconClass} />;
  }
};

interface InspirationLink {
  id: number;
  platform: 'youtube' | 'instagram' | 'twitter' | 'tiktok';
  category: string;
  url: string;
  title: string | null;
  addedBy: string | null;
  isActive: boolean;
  mediaType: 'image' | 'video';
  createdAt: string;
}

interface Pagination { page: number; limit: number; total: number; totalPages: number; }
interface Stats { total: number; byPlatform: { platform: string; count: string }[]; byMediaType: { mediaType: string; count: string }[]; categoryCount: number; }

const PLATFORMS = [
  { value: 'youtube', label: 'YouTube', icon: <Youtube className="h-4 w-4 text-red-500" /> },
  { value: 'instagram', label: 'Instagram', icon: <Instagram className="h-4 w-4 text-pink-500" /> },
  { value: 'twitter', label: 'Twitter', icon: <Twitter className="h-4 w-4 text-blue-400" /> },
  { value: 'tiktok', label: 'TikTok', icon: <Music2 className="h-4 w-4" /> },
];

const MEDIA_TYPES = [
  { value: 'image', label: 'Image', icon: <Image className="h-4 w-4 text-green-500" /> },
  { value: 'video', label: 'Video', icon: <Video className="h-4 w-4 text-blue-500" /> },
];

export default function DvybInspirationsPage() {
  const router = useRouter();
  const [inspirations, setInspirations] = useState<InspirationLink[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 20, total: 0, totalPages: 0 });
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [platformFilter, setPlatformFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [mediaTypeFilter, setMediaTypeFilter] = useState('');
  
  // Debounce search term to avoid too many API calls
  const debouncedSearchTerm = useDebounce(searchTerm, 300);
  
  // Track if filters changed to reset pagination
  const isFirstRender = useRef(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [formPlatform, setFormPlatform] = useState('');
  const [formCategory, setFormCategory] = useState('');
  const [formCategorySearch, setFormCategorySearch] = useState('');
  const [formUrl, setFormUrl] = useState('');
  const [formTitle, setFormTitle] = useState('');
  const [formMediaType, setFormMediaType] = useState('image');
  const [submitting, setSubmitting] = useState(false);
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);

  // Edit modal state
  const [editingInspiration, setEditingInspiration] = useState<InspirationLink | null>(null);
  const [editPlatform, setEditPlatform] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editCategorySearch, setEditCategorySearch] = useState('');
  const [editUrl, setEditUrl] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [editMediaType, setEditMediaType] = useState('image');
  const [showEditCategoryDropdown, setShowEditCategoryDropdown] = useState(false);

  const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

  const fetchCategories = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/api/admin/dvyb-inspirations/categories`);
      const data = await response.json();
      if (data.success) setCategories(data.data);
    } catch (error) { console.error('Error fetching categories:', error); }
  }, [API_BASE]);

  const fetchStats = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/api/admin/dvyb-inspirations/stats`);
      const data = await response.json();
      if (data.success) setStats(data.data);
    } catch (error) { console.error('Error fetching stats:', error); }
  }, [API_BASE]);

  const fetchInspirations = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({ page: pagination.page.toString(), limit: pagination.limit.toString() });
      if (debouncedSearchTerm) params.append('search', debouncedSearchTerm);
      if (platformFilter) params.append('platform', platformFilter);
      if (categoryFilter) params.append('category', categoryFilter);
      if (mediaTypeFilter) params.append('mediaType', mediaTypeFilter);
      const response = await fetch(`${API_BASE}/api/admin/dvyb-inspirations?${params}`);
      const data = await response.json();
      if (data.success) { setInspirations(data.data); setPagination(data.pagination); }
    } catch (error) { console.error('Error fetching inspirations:', error); }
    finally { setLoading(false); }
  }, [API_BASE, pagination.page, pagination.limit, debouncedSearchTerm, platformFilter, categoryFilter, mediaTypeFilter]);

  // Reset to page 1 when search or filters change
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    setPagination(p => ({ ...p, page: 1 }));
  }, [debouncedSearchTerm, platformFilter, categoryFilter, mediaTypeFilter]);

  useEffect(() => { fetchInspirations(); }, [fetchInspirations]);
  useEffect(() => { fetchCategories(); fetchStats(); }, [fetchCategories, fetchStats]);

  const filteredCategories = useMemo(() => {
    if (!formCategorySearch) return categories;
    return categories.filter(cat => cat.toLowerCase().includes(formCategorySearch.toLowerCase()));
  }, [categories, formCategorySearch]);

  const showAddNewCategory = formCategorySearch && !categories.some(cat => cat.toLowerCase() === formCategorySearch.toLowerCase());

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formPlatform || !formCategory || !formUrl) { alert('Please fill in all required fields'); return; }
    setSubmitting(true);
    try {
      const response = await fetch(`${API_BASE}/api/admin/dvyb-inspirations`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: formPlatform, category: formCategory, url: formUrl, title: formTitle || null, mediaType: formMediaType }),
      });
      const data = await response.json();
      if (data.success) {
        setFormPlatform(''); setFormCategory(''); setFormCategorySearch(''); setFormUrl(''); setFormTitle(''); setFormMediaType('image'); setShowAddForm(false);
        fetchInspirations(); fetchCategories(); fetchStats();
      } else { alert(data.error || 'Failed to add inspiration link'); }
    } catch (error) { console.error('Error adding inspiration:', error); alert('Failed to add inspiration link'); }
    finally { setSubmitting(false); }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Are you sure you want to delete this inspiration link?')) return;
    try {
      const response = await fetch(`${API_BASE}/api/admin/dvyb-inspirations/${id}`, { method: 'DELETE' });
      const data = await response.json();
      if (data.success) { fetchInspirations(); fetchStats(); } else { alert(data.error || 'Failed to delete'); }
    } catch (error) { console.error('Error deleting:', error); alert('Failed to delete'); }
  };

  const openEditModal = (inspiration: InspirationLink) => {
    setEditingInspiration(inspiration);
    setEditPlatform(inspiration.platform);
    setEditCategory(inspiration.category);
    setEditCategorySearch('');
    setEditUrl(inspiration.url);
    setEditTitle(inspiration.title || '');
    setEditMediaType(inspiration.mediaType || 'image');
  };

  const closeEditModal = () => {
    setEditingInspiration(null);
    setEditPlatform('');
    setEditCategory('');
    setEditCategorySearch('');
    setEditUrl('');
    setEditTitle('');
    setEditMediaType('image');
    setShowEditCategoryDropdown(false);
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingInspiration || !editPlatform || !editCategory || !editUrl) { alert('Please fill in all required fields'); return; }
    setSubmitting(true);
    try {
      const response = await fetch(`${API_BASE}/api/admin/dvyb-inspirations/${editingInspiration.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: editPlatform, category: editCategory, url: editUrl, title: editTitle || null, mediaType: editMediaType }),
      });
      const data = await response.json();
      if (data.success) {
        closeEditModal();
        fetchInspirations(); fetchCategories(); fetchStats();
      } else { alert(data.error || 'Failed to update inspiration link'); }
    } catch (error) { console.error('Error updating inspiration:', error); alert('Failed to update inspiration link'); }
    finally { setSubmitting(false); }
  };

  const filteredEditCategories = useMemo(() => {
    if (!editCategorySearch) return categories;
    return categories.filter(cat => cat.toLowerCase().includes(editCategorySearch.toLowerCase()));
  }, [categories, editCategorySearch]);

  const showEditAddNewCategory = editCategorySearch && !categories.some(cat => cat.toLowerCase() === editCategorySearch.toLowerCase());

  const formatDate = (dateString: string) => new Date(dateString).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <Button variant="outline" onClick={() => router.push('/admin/dashboard')} className="flex items-center gap-2 text-gray-700 border-gray-300 hover:bg-gray-100">
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Dvyb Inspirations</h1>
            <p className="text-gray-600 text-sm">Manage inspiration links for AI content generation</p>
          </div>
        </div>
        <Button onClick={() => setShowAddForm(!showAddForm)} className="bg-purple-600 hover:bg-purple-700 text-white flex items-center gap-2">
          {showAddForm ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {showAddForm ? 'Cancel' : 'Add Inspiration'}
        </Button>
      </div>

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4 mb-6">
          <div className="bg-white rounded-lg shadow p-4"><div className="text-2xl font-bold text-gray-900">{stats.total}</div><div className="text-sm text-gray-500">Total Links</div></div>
          <div className="bg-white rounded-lg shadow p-4"><div className="text-2xl font-bold text-gray-900">{stats.categoryCount}</div><div className="text-sm text-gray-500">Categories</div></div>
          {MEDIA_TYPES.map(m => {
            const count = stats.byMediaType?.find(s => s.mediaType === m.value)?.count || '0';
            return (<div key={m.value} className="bg-white rounded-lg shadow p-4"><div className="flex items-center gap-2">{m.icon}<div className="text-xl font-bold text-gray-900">{count}</div></div><div className="text-sm text-gray-500">{m.label}s</div></div>);
          })}
          {PLATFORMS.map(p => {
            const count = stats.byPlatform.find(s => s.platform === p.value)?.count || '0';
            return (<div key={p.value} className="bg-white rounded-lg shadow p-4"><div className="flex items-center gap-2">{p.icon}<div className="text-xl font-bold text-gray-900">{count}</div></div><div className="text-sm text-gray-500">{p.label}</div></div>);
          })}
        </div>
      )}

      {showAddForm && (
        <div className="bg-white rounded-lg shadow-lg p-6 mb-6 border-2 border-purple-200">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Add New Inspiration Link</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Platform <span className="text-red-500">*</span></label>
                <div className="flex flex-wrap gap-2">
                  {PLATFORMS.map(p => (
                    <button key={p.value} type="button" onClick={() => setFormPlatform(p.value)}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg border-2 transition-all ${formPlatform === p.value ? 'border-purple-500 bg-purple-50' : 'border-gray-200 hover:border-gray-300'}`}>
                      {p.icon}<span className="text-sm text-gray-700">{p.label}</span>{formPlatform === p.value && <Check className="h-4 w-4 text-purple-600" />}
                    </button>
                  ))}
                </div>
              </div>
              <div className="relative">
                <label className="block text-sm font-medium text-gray-700 mb-2">Category <span className="text-red-500">*</span></label>
                <div className="relative">
                  <input type="text" value={formCategory || formCategorySearch}
                    onChange={(e) => { setFormCategorySearch(e.target.value); setFormCategory(''); setShowCategoryDropdown(true); }}
                    onFocus={() => setShowCategoryDropdown(true)} placeholder="Search or add category..."
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-gray-900 bg-white" />
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                </div>
                {showCategoryDropdown && (formCategorySearch || categories.length > 0) && (
                  <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    {showAddNewCategory && (<button type="button" onClick={() => { setFormCategory(formCategorySearch); setShowCategoryDropdown(false); }}
                      className="w-full px-4 py-2 text-left hover:bg-purple-50 flex items-center gap-2 text-purple-600"><Plus className="h-4 w-4" /><span>Add &quot;{formCategorySearch}&quot;</span></button>)}
                    {filteredCategories.map(cat => (<button key={cat} type="button" onClick={() => { setFormCategory(cat); setFormCategorySearch(''); setShowCategoryDropdown(false); }}
                      className="w-full px-4 py-2 text-left hover:bg-gray-50 text-gray-700">{cat}</button>))}
                  </div>
                )}
              </div>
              <div><label className="block text-sm font-medium text-gray-700 mb-2">URL <span className="text-red-500">*</span></label>
                <input type="url" value={formUrl} onChange={(e) => setFormUrl(e.target.value)} placeholder="https://..." required
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-gray-900 bg-white" /></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-2">Title <span className="text-gray-400">(optional)</span></label>
                <input type="text" value={formTitle} onChange={(e) => setFormTitle(e.target.value)} placeholder="Brief description..."
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-gray-900 bg-white" /></div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Media Type <span className="text-red-500">*</span></label>
              <div className="flex flex-wrap gap-2">
                {MEDIA_TYPES.map(m => (
                  <button key={m.value} type="button" onClick={() => setFormMediaType(m.value)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border-2 transition-all ${formMediaType === m.value ? 'border-purple-500 bg-purple-50' : 'border-gray-200 hover:border-gray-300'}`}>
                    {m.icon}<span className="text-sm text-gray-700">{m.label}</span>{formMediaType === m.value && <Check className="h-4 w-4 text-purple-600" />}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex justify-end">
              <Button type="submit" disabled={submitting || !formPlatform || !formCategory || !formUrl} className="bg-purple-600 hover:bg-purple-700 text-white flex items-center gap-2">
                {submitting ? <><Loader2 className="h-4 w-4 animate-spin" />Adding...</> : <><Plus className="h-4 w-4" />Add Inspiration</>}
              </Button>
            </div>
          </form>
        </div>
      )}

      <div className="bg-white rounded-lg shadow p-4 mb-6">
        <div className="flex flex-wrap items-center gap-4">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input type="text" placeholder="Search..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-gray-900 bg-white" />
          </div>
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-gray-400" />
            <select value={platformFilter} onChange={(e) => setPlatformFilter(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white">
              <option value="">All Platforms</option>{PLATFORMS.map(p => (<option key={p.value} value={p.value}>{p.label}</option>))}
            </select>
          </div>
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white">
            <option value="">All Categories</option>{categories.map(cat => (<option key={cat} value={cat}>{cat}</option>))}
          </select>
          <select value={mediaTypeFilter} onChange={(e) => setMediaTypeFilter(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white">
            <option value="">All Types</option>{MEDIA_TYPES.map(m => (<option key={m.value} value={m.value}>{m.label}</option>))}
          </select>
          {(searchTerm || platformFilter || categoryFilter || mediaTypeFilter) && (<Button variant="ghost" onClick={() => { setSearchTerm(''); setPlatformFilter(''); setCategoryFilter(''); setMediaTypeFilter(''); }} className="text-gray-500">Clear</Button>)}
        </div>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Platform</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Category</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">URL</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Title</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Added</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {loading ? (<tr><td colSpan={7} className="px-6 py-12 text-center"><Loader2 className="h-8 w-8 animate-spin mx-auto text-purple-500" /><p className="mt-2 text-gray-500">Loading...</p></td></tr>)
            : inspirations.length === 0 ? (<tr><td colSpan={7} className="px-6 py-12 text-center text-gray-500">No inspiration links found.</td></tr>)
            : inspirations.map((i) => (
              <tr key={i.id} className="hover:bg-gray-50">
                <td className="px-6 py-4"><div className="flex items-center gap-2"><PlatformIcon platform={i.platform} /><span className="text-sm text-gray-900 capitalize">{i.platform}</span></div></td>
                <td className="px-6 py-4"><span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800">{i.category}</span></td>
                <td className="px-6 py-4">
                  <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${i.mediaType === 'video' ? 'bg-blue-100 text-blue-800' : 'bg-green-100 text-green-800'}`}>
                    {i.mediaType === 'video' ? <Video className="h-3 w-3" /> : <Image className="h-3 w-3" />}
                    {i.mediaType === 'video' ? 'Video' : 'Image'}
                  </span>
                </td>
                <td className="px-6 py-4"><a href={i.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline text-sm truncate block max-w-[300px]">{i.url}</a></td>
                <td className="px-6 py-4"><span className="text-sm text-gray-600 truncate block max-w-[200px]">{i.title || '-'}</span></td>
                <td className="px-6 py-4"><span className="text-sm text-gray-500">{formatDate(i.createdAt)}</span></td>
                <td className="px-6 py-4"><div className="flex items-center gap-2">
                  <button onClick={() => openEditModal(i)} className="p-2 hover:bg-purple-50 rounded-lg" title="Edit"><Pencil className="h-4 w-4 text-purple-500" /></button>
                  <a href={i.url} target="_blank" rel="noopener noreferrer" className="p-2 hover:bg-gray-100 rounded-lg" title="Open URL"><ExternalLink className="h-4 w-4 text-gray-500" /></a>
                  <button onClick={() => handleDelete(i.id)} className="p-2 hover:bg-red-50 rounded-lg" title="Delete"><Trash2 className="h-4 w-4 text-red-500" /></button>
                </div></td>
              </tr>
            ))}
          </tbody>
        </table>
        {pagination.totalPages > 1 && (
          <div className="px-6 py-4 border-t flex items-center justify-between">
            <div className="text-sm text-gray-500">Page {pagination.page} of {pagination.totalPages} ({pagination.total} total)</div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={pagination.page === 1} onClick={() => setPagination(p => ({ ...p, page: p.page - 1 }))}>Previous</Button>
              <Button variant="outline" size="sm" disabled={pagination.page === pagination.totalPages} onClick={() => setPagination(p => ({ ...p, page: p.page + 1 }))}>Next</Button>
            </div>
          </div>
        )}
      </div>
      {showCategoryDropdown && <div className="fixed inset-0 z-0" onClick={() => setShowCategoryDropdown(false)} />}

      {/* Edit Modal */}
      {editingInspiration && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-4 border-b">
              <h2 className="text-lg font-semibold text-gray-900">Edit Inspiration Link</h2>
              <button onClick={closeEditModal} className="p-2 hover:bg-gray-100 rounded-lg"><X className="h-5 w-5 text-gray-500" /></button>
            </div>
            <form onSubmit={handleUpdate} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Platform <span className="text-red-500">*</span></label>
                <div className="flex flex-wrap gap-2">
                  {PLATFORMS.map(p => (
                    <button key={p.value} type="button" onClick={() => setEditPlatform(p.value)}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg border-2 transition-all ${editPlatform === p.value ? 'border-purple-500 bg-purple-50' : 'border-gray-200 hover:border-gray-300'}`}>
                      {p.icon}<span className="text-sm text-gray-700">{p.label}</span>{editPlatform === p.value && <Check className="h-4 w-4 text-purple-600" />}
                    </button>
                  ))}
                </div>
              </div>
              <div className="relative">
                <label className="block text-sm font-medium text-gray-700 mb-2">Category <span className="text-red-500">*</span></label>
                <div className="relative">
                  <input type="text" value={editCategory || editCategorySearch}
                    onChange={(e) => { setEditCategorySearch(e.target.value); setEditCategory(''); setShowEditCategoryDropdown(true); }}
                    onFocus={() => setShowEditCategoryDropdown(true)} placeholder="Search or add category..."
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-gray-900 bg-white" />
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                </div>
                {showEditCategoryDropdown && (editCategorySearch || categories.length > 0) && (
                  <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    {showEditAddNewCategory && (<button type="button" onClick={() => { setEditCategory(editCategorySearch); setShowEditCategoryDropdown(false); }}
                      className="w-full px-4 py-2 text-left hover:bg-purple-50 flex items-center gap-2 text-purple-600"><Plus className="h-4 w-4" /><span>Add &quot;{editCategorySearch}&quot;</span></button>)}
                    {filteredEditCategories.map(cat => (<button key={cat} type="button" onClick={() => { setEditCategory(cat); setEditCategorySearch(''); setShowEditCategoryDropdown(false); }}
                      className="w-full px-4 py-2 text-left hover:bg-gray-50 text-gray-700">{cat}</button>))}
                  </div>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">URL <span className="text-red-500">*</span></label>
                <input type="url" value={editUrl} onChange={(e) => setEditUrl(e.target.value)} placeholder="https://..." required
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-gray-900 bg-white" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Title <span className="text-gray-400">(optional)</span></label>
                <input type="text" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} placeholder="Brief description..."
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-gray-900 bg-white" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Media Type <span className="text-red-500">*</span></label>
                <div className="flex flex-wrap gap-2">
                  {MEDIA_TYPES.map(m => (
                    <button key={m.value} type="button" onClick={() => setEditMediaType(m.value)}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg border-2 transition-all ${editMediaType === m.value ? 'border-purple-500 bg-purple-50' : 'border-gray-200 hover:border-gray-300'}`}>
                      {m.icon}<span className="text-sm text-gray-700">{m.label}</span>{editMediaType === m.value && <Check className="h-4 w-4 text-purple-600" />}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-4 border-t">
                <Button type="button" variant="outline" onClick={closeEditModal} className="text-gray-700">Cancel</Button>
                <Button type="submit" disabled={submitting || !editPlatform || !editCategory || !editUrl} className="bg-purple-600 hover:bg-purple-700 text-white flex items-center gap-2">
                  {submitting ? <><Loader2 className="h-4 w-4 animate-spin" />Saving...</> : <><Check className="h-4 w-4" />Save Changes</>}
                </Button>
              </div>
            </form>
          </div>
          {showEditCategoryDropdown && <div className="fixed inset-0 z-0" onClick={() => setShowEditCategoryDropdown(false)} />}
        </div>
      )}
    </div>
  );
}
