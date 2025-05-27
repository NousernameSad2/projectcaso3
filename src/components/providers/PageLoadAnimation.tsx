'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

const PageLoadAnimation = () => {
  const pathname = usePathname();

  useEffect(() => {
    // Ensure this only runs on the client
    if (typeof window !== 'undefined') {
      document.body.classList.add('play-page-load-animation');

      // Set a timeout to remove the class after the animation completes
      const timer = setTimeout(() => {
        document.body.classList.remove('play-page-load-animation');
      }, 800); // Animation is 0.8s, can remove class right after

      // Cleanup timeout on component unmount or before next run
      return () => clearTimeout(timer);
    }
  }, [pathname]); // Add pathname to dependency array

  return null; // This component does not render anything
};

export default PageLoadAnimation; 