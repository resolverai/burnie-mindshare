'use client'

import React, { useState, useEffect } from 'react'
import Image from 'next/image'
import { XMarkIcon } from '@heroicons/react/24/outline'

interface OnboardingModalProps {
  isOpen: boolean
  onClose: () => void
}

export default function OnboardingModal({ isOpen, onClose }: OnboardingModalProps) {
  const [currentStep, setCurrentStep] = useState(1)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const handleNext = () => {
    if (currentStep < 4) {
      setCurrentStep(currentStep + 1)
    }
  }

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1)
    }
  }

  const handleGetStarted = () => {
    setCurrentStep(2)
  }

  const handleClose = () => {
    setCurrentStep(1)
    onClose()
  }

  if (!mounted || !isOpen) return null

  const progressPercentage = (currentStep / 4) * 100

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[100] p-4 overflow-y-auto">
      <div 
        className="relative bg-[#1a0808] border border-[#3a1a1a] rounded-2xl shadow-2xl w-full max-w-6xl mx-auto"
        style={{ 
          minHeight: '600px',
          maxHeight: '90vh',
          height: 'auto'
        }}
      >
        {/* Progress Bar */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-[#3a1a1a] rounded-t-2xl overflow-hidden">
          <div 
            className="h-full bg-gradient-to-r from-orange-500 to-orange-600 transition-all duration-500 ease-out"
            style={{ width: `${progressPercentage}%` }}
          />
        </div>

        {/* Close Button */}
        <button
          onClick={handleClose}
          className="absolute top-4 right-4 z-10 text-white/60 hover:text-white transition-colors p-2 hover:bg-white/10 rounded-lg"
        >
          <XMarkIcon className="h-6 w-6" />
        </button>

        {/* Content Container - Fixed Height */}
        <div className="p-6 md:p-10 lg:p-12" style={{ minHeight: '600px' }}>
          {/* Step 1: Welcome */}
          {currentStep === 1 && (
            <div className="flex flex-col items-center justify-center text-center h-full min-h-[500px]">
              <div className="flex items-center justify-center gap-6 md:gap-10 mb-8 md:mb-12">
                <div className="relative w-20 h-20 md:w-28 md:h-28">
                  <Image
                    src="/burnie-logo.png"
                    alt="Burnie AI"
                    fill
                    className="object-contain"
                  />
                </div>
                <div className="text-white text-3xl md:text-5xl font-bold">✕</div>
                <div className="relative w-20 h-20 md:w-28 md:h-28">
                  <Image
                    src="/somnia-logo.png"
                    alt="Somnia"
                    fill
                    className="object-contain"
                  />
                </div>
              </div>

              <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-orange-400 via-orange-500 to-orange-600 mb-6 font-nt-brick">
                Welcome to YAP.BURNIE
              </h1>

              <p className="text-white/80 text-base md:text-lg lg:text-xl max-w-3xl mb-10 md:mb-12 font-nt-brick leading-relaxed">
                Join the Somnia Dreamathon. Create content, earn rewards, and power the future of Web3.
              </p>

              <button
                onClick={handleGetStarted}
                className="group relative px-8 py-4 bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white text-lg font-bold rounded-xl transition-all duration-300 transform hover:scale-105 shadow-lg hover:shadow-xl font-nt-brick flex items-center gap-2"
              >
                Get Started
                <span className="text-xl">👋</span>
              </button>
            </div>
          )}

          {/* Step 2: Yappers and Miners */}
          {currentStep === 2 && (
            <div className="flex flex-col h-full min-h-[500px]">
              <div className="text-center mb-8 md:mb-10">
                <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-orange-400 to-orange-600 mb-4 font-nt-brick">
                  Yap and Earn for Somnia Dreamathon
                </h2>
                <p className="text-white/70 text-base md:text-lg">
                  Join the Somnia Dreamathon and turn your creativity into rewards. Earn $ROAST tokens while supporting next-gen Web3 projects on Somnia.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8 flex-1">
                {/* Yapper Card */}
                <div className="bg-[#2a1010] border border-[#3a1a1a] rounded-2xl p-6 md:p-8 hover:border-orange-500/50 transition-all duration-300 flex flex-col">
                  <div className="flex items-center gap-4 mb-6">
                    <div className="relative w-16 h-16 md:w-24 md:h-24 bg-[#3a1a1a] rounded-2xl flex-shrink-0">
                      <Image
                        src="/yapper.png"
                        alt="Yapper"
                        fill
                        className="object-contain p-3"
                      />
                    </div>
                    <h3 className="text-lg md:text-xl lg:text-2xl font-bold text-white font-nt-brick leading-tight">
                      Yap Dreamathon Projects
                    </h3>
                  </div>
                  <p className="text-white/70 text-sm md:text-base leading-relaxed flex-1">
                    Connect Somnia testnet. Pick any content you like (All content for Dreamathon projects is free). Connect X and post!
                  </p>
                </div>

                {/* Miner Card */}
                <div className="bg-[#2a1010] border border-[#3a1a1a] rounded-2xl p-6 md:p-8 hover:border-orange-500/50 transition-all duration-300 flex flex-col">
                  <div className="flex items-center gap-4 mb-6">
                    <div className="relative w-16 h-16 md:w-24 md:h-24 bg-[#3a1a1a] rounded-2xl flex-shrink-0">
                      <Image
                        src="/miner.png"
                        alt="Content Miner"
                        fill
                        className="object-contain p-3"
                      />
                    </div>
                    <h3 className="text-lg md:text-xl lg:text-2xl font-bold text-white font-nt-brick leading-tight">
                      Content Nodes
                    </h3>
                  </div>
                  <p className="text-white/70 text-sm md:text-base leading-relaxed flex-1">
                    Mine content & earn passive income. Setup AI agents that create content and sell on your behalf
                  </p>
                </div>
              </div>

              <div className="flex justify-end mt-8">
                <button
                  onClick={handleNext}
                  className="px-6 py-3 bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white font-bold rounded-xl transition-all duration-300 font-nt-brick flex items-center gap-2"
                >
                  Next
                  <span>→</span>
                </button>
              </div>
            </div>
          )}

          {/* Step 3: How to Yap and Earn */}
          {currentStep === 3 && (
            <div className="flex flex-col h-full min-h-[500px]">
              <div className="mb-6">
                <h2 className="text-3xl md:text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-orange-400 to-orange-600 mb-2 font-nt-brick">
                  How to Yap and Earn
                </h2>
                <p className="text-white/70 text-sm md:text-base font-nt-brick">
                  Learn how to purchase content, edit it, and publish on X to earn $ROAST
                </p>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 md:gap-8 flex-1">
                {/* Left Side - Instructions */}
                <div className="flex flex-col gap-4">
                  {/* Earn Activity Box */}
                  <div className="bg-[#2a1010] border border-[#3a1a1a] rounded-xl p-4 md:p-6">
                    <div className="flex items-center gap-2 mb-4">
                      <span className="text-2xl">💰</span>
                      <h3 className="text-lg md:text-xl font-bold text-white font-nt-brick">
                        Earn $ROAST for Every Activity
                      </h3>
                    </div>
                    <ul className="space-y-2 text-white/70 text-sm md:text-base">
                      <li className="flex items-start gap-2">
                        <span className="text-orange-500 mt-1">•</span>
                        <span>Purchase content and customize it</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-orange-500 mt-1">•</span>
                        <span>Publish your content on X (Twitter)</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-orange-500 mt-1">•</span>
                        <span>Earn tokens for impressions and engagement</span>
                      </li>
                    </ul>
                  </div>

                  {/* Check Ranking Button */}
                  <button
                    onClick={() => window.open('/campaign', '_blank')}
                    className="w-full bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white font-bold rounded-xl py-4 transition-all duration-300 font-nt-brick flex items-center justify-center gap-1 md:gap-2 text-xs md:text-base"
                  >
                    Check Your Ranking on the Leaderboard
                    <span>→</span>
                  </button>

                  {/* Featured Projects */}
                  <div className="bg-[#2a1010] border border-[#3a1a1a] rounded-xl p-4 md:p-6">
                    <h3 className="text-base md:text-lg font-bold text-white mb-4 font-nt-brick text-center">
                      Featured Dreamathon Projects
                    </h3>
                    <div className="grid grid-cols-5 gap-3">
                      {[
                        { name: 'BitRedict', img: '/bitredict.jpg' },
                        { name: 'Carbonopus', img: '/carbonopus.jpg' },
                        { name: 'Likwid', img: '/likwid.png' },
                        { name: 'Dolos', img: '/dolos.png' },
                        { name: 'Academy', img: '/academy.jpg' },
                        { name: 'Ensemble', img: '/ensemble.jpg' },
                        { name: 'Portal', img: '/portal.jpg' },
                        { name: 'Pixelmon', img: '/pixelmon.jpg' },
                        { name: 'Sherry', img: '/sherry-protocol.png' },
                        { name: 'UnrealAI', img: '/unrealai.jpg' },
                      ].map((project) => (
                        <div
                          key={project.name}
                          className="relative aspect-square bg-[#1a0808] rounded-lg overflow-hidden border border-[#3a1a1a] hover:border-orange-500/50 transition-all duration-300 group"
                          title={project.name}
                        >
                          <Image
                            src={project.img}
                            alt={project.name}
                            fill
                            className="object-cover group-hover:scale-110 transition-transform duration-300"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Right Side - Video */}
                <div className="bg-[#2a1010] border border-[#3a1a1a] rounded-xl p-4 md:p-6 flex flex-col items-center justify-center">
                  <h3 className="text-lg md:text-xl font-bold text-white mb-2 font-nt-brick text-center">
                    Video Tutorial: Purchase, Edit & Publish
                  </h3>
                  <p className="text-white/60 text-xs md:text-sm mb-4 font-nt-brick text-center">
                    Watch how to get started with yapping
                  </p>
                  <div className="w-full max-w-[200px] mx-auto aspect-[9/16] bg-black rounded-lg overflow-hidden">
                    <video
                      controls
                      className="w-full h-full"
                      poster="/yapper.png"
                    >
                      <source
                        src="https://burnie-videos.s3.us-east-1.amazonaws.com/somnia/yapper-demo-video.mp4"
                        type="video/mp4"
                      />
                      Your browser does not support the video tag.
                    </video>
                  </div>
                </div>
              </div>

              <div className="flex justify-between mt-6">
                <button
                  onClick={handleBack}
                  className="px-6 py-3 bg-[#451616] hover:bg-[#743636] text-white font-bold rounded-xl transition-all duration-300 font-nt-brick"
                >
                  ← Back
                </button>
                <button
                  onClick={handleNext}
                  className="px-6 py-3 bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white font-bold rounded-xl transition-all duration-300 font-nt-brick flex items-center gap-2"
                >
                  Next
                  <span>→</span>
                </button>
              </div>
            </div>
          )}

          {/* Step 4: Become a Content Miner */}
          {currentStep === 4 && (
            <div className="flex flex-col h-full min-h-[500px]">
              <div className="mb-6">
                <h2 className="text-3xl md:text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-orange-400 to-orange-600 mb-2 font-nt-brick">
                  Become a Content Miner
                </h2>
                <p className="text-white/70 text-sm md:text-base font-nt-brick">
                  Set up an AI-powered content node and earn passive income
                </p>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 md:gap-8 flex-1">
                {/* Left Side - Instructions */}
                <div className="flex flex-col gap-4">
                  {/* How It Works */}
                  <div className="bg-[#2a1010] border border-[#3a1a1a] rounded-xl p-4 md:p-6 flex-1">
                    <h3 className="text-lg md:text-xl font-bold text-white mb-4 font-nt-brick">
                      How Content Mining Works
                    </h3>
                    <ul className="space-y-3 text-white/70 text-sm md:text-base">
                      <li className="flex items-start gap-2">
                        <span className="text-orange-500 font-bold mt-1">•</span>
                        <span>Set up a content mining node with an AI agent</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-orange-500 font-bold mt-1">•</span>
                        <span>Your node automatically creates content for the platform</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-orange-500 font-bold mt-1">•</span>
                        <span>Earn rewards for node uptime and reliability</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-orange-500 font-bold mt-1">•</span>
                        <span>Receive 70% of revenue every time your content is sold</span>
                      </li>
                    </ul>
                  </div>

                  {/* Revenue Share */}
                  <div className="bg-gradient-to-r from-orange-500/20 to-orange-600/20 border border-orange-500/50 rounded-xl p-4 md:p-6">
                    <div className="flex items-center gap-3 mb-2">
                      <span className="text-3xl">💰</span>
                      <h3 className="text-xl md:text-2xl font-bold text-white">
                        70% Revenue Share
                      </h3>
                    </div>
                    <p className="text-white/80 text-sm md:text-base">
                      Per content sale
                    </p>
                  </div>

                  {/* CTA */}
                  <div className="bg-[#2a1010] border border-[#3a1a1a] rounded-xl p-4 text-center">
                    <p className="text-white/70 text-sm md:text-base font-nt-brick font-bold">
                      Yap • Earn Points • Qualify to run nodes
                    </p>
                  </div>
                </div>

                {/* Right Side - Video */}
                <div className="bg-[#2a1010] border border-[#3a1a1a] rounded-xl p-4 md:p-6 flex flex-col items-center justify-center">
                  <div className="relative w-20 h-20 mb-4 bg-[#3a1a1a] rounded-full flex items-center justify-center">
                    <Image
                      src="/miner.png"
                      alt="Mining Tutorial"
                      width={48}
                      height={48}
                      className="object-contain"
                    />
                  </div>
                  <h3 className="text-lg md:text-xl font-bold text-white mb-2 font-nt-brick text-center">
                    Mining Tutorial Video
                  </h3>
                  <p className="text-white/60 text-xs md:text-sm mb-4 font-nt-brick text-center">
                    Learn how to set up your content mining node
                  </p>
                  <div className="w-full aspect-[9/16] md:aspect-video bg-black rounded-lg overflow-hidden">
                    <video
                      controls
                      className="w-full h-full object-contain"
                      poster="/miner.png"
                    >
                      <source
                        src="https://burnie-videos.s3.us-east-1.amazonaws.com/somnia/miner-demo-video.mp4"
                        type="video/mp4"
                      />
                      Your browser does not support the video tag.
                    </video>
                  </div>
                </div>
              </div>

              <div className="flex justify-between mt-6">
                <button
                  onClick={handleBack}
                  className="px-6 py-3 bg-[#451616] hover:bg-[#743636] text-white font-bold rounded-xl transition-all duration-300 font-nt-brick"
                >
                  ← Back
                </button>
                <button
                  onClick={handleClose}
                  className="px-8 py-3 bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white font-bold rounded-xl transition-all duration-300 font-nt-brick shadow-lg"
                >
                  Start Yapping
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

