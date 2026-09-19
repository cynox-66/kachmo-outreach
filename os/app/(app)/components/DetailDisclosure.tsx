'use client';

import React, { useState } from 'react';

interface DetailDisclosureProps {
  simpleView: React.ReactNode;
  intelligenceView: React.ReactNode;
}

export function DetailDisclosure({ simpleView, intelligenceView }: DetailDisclosureProps) {
  const [activeTab, setActiveTab] = useState<'simple' | 'intelligence'>('simple');

  return (
    <div className="detail-disclosure">
      <div className="detail-tabs-bar">
        <button
          type="button"
          className={`detail-tab-btn ${activeTab === 'simple' ? 'active' : ''}`}
          onClick={() => setActiveTab('simple')}
        >
          Overview
        </button>
        <button
          type="button"
          className={`detail-tab-btn ${activeTab === 'intelligence' ? 'active' : ''}`}
          onClick={() => setActiveTab('intelligence')}
        >
          Full Intelligence
        </button>
      </div>

      {activeTab === 'simple' ? (
        <div className="detail-view-simple">
          {simpleView}
          <div className="view-more-box">
            <p className="small muted">
              Looking for qualification gates, evidence sources, score breakdown, or raw contact provenance?
            </p>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                setActiveTab('intelligence');
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
            >
              View full intelligence →
            </button>
          </div>
        </div>
      ) : (
        <div className="detail-view-intelligence">
          <div className="view-less-box">
            <button
              type="button"
              className="link small"
              onClick={() => {
                setActiveTab('simple');
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
            >
              ← Back to simple overview
            </button>
          </div>
          {intelligenceView}
        </div>
      )}
    </div>
  );
}
