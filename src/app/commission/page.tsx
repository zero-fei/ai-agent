'use client';

import React from 'react';
import styles from './page.module.css';

const CommissionPage = () => {
  const showSignDialog = true;

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.backBtn}>&lt;</div>
        <h1 className={styles.title}>我的佣金</h1>
      </header>

      <main className={styles.content}>
        <section className={styles.card}>
          <div className={styles.cardLabel}>已结算佣金余额</div>
          <div className={styles.cardAmount}>
            <span className={styles.currency}>¥</span>
            <span>760</span>
          </div>
          <div className={styles.cardDetail}>
            查看详情 &gt;
          </div>
        </section>

        <div className={styles.sectionTitle}>
          <div className={styles.indicator}></div>
          <span>本月直播收入</span>
        </div>

        <div className={styles.listItem}>
          <div className={styles.itemInfo}>
            <div className={styles.itemName}>礼物日结收入</div>
            <div className={styles.itemDesc}>虎牙日结钱包剩余佣金</div>
          </div>
          <div className={styles.itemAction}>
            <div className={styles.itemAmount}>
              760 元 &gt;
            </div>
            <button className={styles.withdrawBtn}>
              立即提现
            </button>
          </div>
        </div>
      </main>

      {showSignDialog && (
        <div className={styles.dialogOverlay}>
          <div className={styles.dialogCard}>
            <button className={styles.dialogClose} aria-label="关闭弹窗">
              ×
            </button>
            <h2 className={styles.dialogTitle}>劳务报税签约</h2>
            <p className={styles.dialogText}>
              根据国家最新《个人所得税法》要求，平台企业方于今日起收入信息需核验，请先完成签约。
            </p>
            <button className={styles.dialogAction}>立即签约</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default CommissionPage;
