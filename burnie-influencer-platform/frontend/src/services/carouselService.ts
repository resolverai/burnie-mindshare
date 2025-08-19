import axios from 'axios';
import { HeroSlide } from '../components/yapper/HeroCarousel';

const API_BASE_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

export const carouselService = {
  /**
   * Fetch carousel slides for hero banner
   */
  async getCarouselSlides(): Promise<HeroSlide[]> {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/carousel`);
      return response.data || [];
    } catch (error) {
      console.error('Error fetching carousel slides:', error);
      
      // Return fallback slides based on actual database campaigns  
      return [
        {
          id: '1',
          backgroundUrl: '/hero.svg',
          title: 'AI Revolution: Roast the Future of Tech',
          endText: 'End date 31-Aug-2025',
          tag: 'cookie.fun',
          gallery: ['/card01.svg', '/card02.svg', '12']
        },
        {
          id: '2',
          backgroundUrl: '/card01.svg',
          title: 'Earn BOB (Build on Bitcoin) SNAPS & climb the leaderboard',

          endText: 'End date 31-Aug-2025',
          tag: 'cookie.fun',
          gallery: ['/card02.svg', '/card03.svg', '8']
        },
        {
          id: '3',
          backgroundUrl: '/card02.svg',
          title: 'Web3 Creator Stories: Build the Metaverse Narrative',

          endText: 'End date 31-Aug-2025',
          tag: 'burnie',
          gallery: ['/card03.svg', '/hero.svg', '5']
        }
      ];
    }
  }
};

export default carouselService;
