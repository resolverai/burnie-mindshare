const API_BASE_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

export interface FilterOptions {
  platforms: string[];
  projects: string[];
}

export const fetchFilterOptions = async (): Promise<FilterOptions> => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/filter-options`);
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.success) {
      return {
        platforms: ['all', ...data.data.platforms],
        projects: ['all', ...data.data.projects]
      };
    } else {
      throw new Error(data.message || 'Failed to fetch filter options');
    }
  } catch (error) {
    console.error('Error fetching filter options:', error);
    // Return fallback data if API fails
    return {
      platforms: ['all', 'cookie.fun', 'yaps.kaito.ai', 'burnie', 'openledger'],
      projects: ['all', 'Project A', 'Project B', 'Project C']
    };
  }
};

export default {
  fetchFilterOptions
};
