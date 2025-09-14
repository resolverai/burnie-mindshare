import { useEffect } from 'react';
import { useAccount } from 'wagmi';
import mixpanelService from '../services/mixpanelService';

export const useMixpanel = () => {
  const { address, isConnected } = useAccount();

  useEffect(() => {
    // Initialize Mixpanel when component mounts (only once)
    mixpanelService.initialize(address);

    // Identify user when wallet connects (separate from initialization)
    if (isConnected && address) {
      // Small delay to ensure Mixpanel is ready
      setTimeout(() => {
        mixpanelService.identifyUser(address);
      }, 100);
    }
  }, [isConnected, address]);

  return mixpanelService;
};

export default useMixpanel;
