const express = require('express');
const { requireLogin, requireRole } = require('../middleware/auth');
const { TYPE_GROUPS, TYPE_LABELS } = require('../constants/scrap');
const { sendServerError } = require('../utils/responses');

const router = express.Router();

function formatDateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(value).split('T')[0].split(' ')[0];
}

router.get('/managerial/report', requireLogin, requireRole('managerial', 'superadmin'), async (req, res) => {
  try {
    const { pool } = req.app.locals;
    const { branch, dateFrom, dateTo } = req.query;

    const params = [];
    const conditions = [`s.status = 'completed'`];

    if (branch) {
      params.push(branch);
      conditions.push(`s.branch = $${params.length}`);
    }
    if (dateFrom) {
      params.push(dateFrom);
      conditions.push(`s.disposal_submitted_at >= $${params.length}::date`);
    }
    if (dateTo) {
      params.push(dateTo);
      conditions.push(`s.disposal_submitted_at < ($${params.length}::date + INTERVAL '1 day')`);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;

    const totalRes = await pool.query(
      `SELECT COUNT(DISTINCT s.id) AS cnt, COALESCE(SUM(si.weight),0) AS w
       FROM submissions s
       LEFT JOIN submission_items si ON si.submission_id = s.id
       ${where}`,
      params
    );

    const typeRes = await pool.query(
      `SELECT si.scrap_type, SUM(si.weight) AS w
       FROM submission_items si
       JOIN submissions s ON s.id = si.submission_id
       ${where}
       GROUP BY si.scrap_type ORDER BY w DESC`,
      params
    );

    const locationRes = await pool.query(
      `SELECT s.disposal_location, COALESCE(SUM(si.weight),0) AS w
       FROM submissions s
       LEFT JOIN submission_items si ON si.submission_id = s.id
       ${where}
       GROUP BY s.disposal_location ORDER BY w DESC`,
      params
    );

    const branchRes = await pool.query(
      `SELECT s.branch, COALESCE(SUM(si.weight),0) AS w
       FROM submissions s
       LEFT JOIN submission_items si ON si.submission_id = s.id
       ${where}
       GROUP BY s.branch ORDER BY w DESC`,
      params
    );

    const recentRes = await pool.query(
      `SELECT s.id, s.branch, s.collector_name, s.disposal_location, s.disposal_submitted_at,
              s.approved_by, COALESCE(SUM(si.weight),0) AS total_weight
       FROM submissions s
       LEFT JOIN submission_items si ON si.submission_id = s.id
       ${where}
       GROUP BY s.id ORDER BY s.disposal_submitted_at DESC LIMIT 50`,
      params
    );

    const weightByGroup = { thin: 0, thick: 0, special: 0 };
    const byType = typeRes.rows.map((r) => {
      const w = parseFloat(r.w) || 0;
      for (const [group, types] of Object.entries(TYPE_GROUPS)) {
        if (types.includes(r.scrap_type)) weightByGroup[group] += w;
      }
      return {
        type: r.scrap_type,
        label: TYPE_LABELS[r.scrap_type] || r.scrap_type,
        weight: Math.round(w * 100) / 100,
      };
    });

    return res.json({
      total: {
        submissions: parseInt(totalRes.rows[0]?.cnt || 0, 10),
        weight: Math.round((parseFloat(totalRes.rows[0]?.w) || 0) * 100) / 100,
      },
      weightByGroup: {
        thin: Math.round(weightByGroup.thin * 100) / 100,
        thick: Math.round(weightByGroup.thick * 100) / 100,
        special: Math.round(weightByGroup.special * 100) / 100,
      },
      byType,
      byLocation: locationRes.rows.map((r) => ({
        location: r.disposal_location || '(ไม่ระบุ)',
        weight: Math.round((parseFloat(r.w) || 0) * 100) / 100,
      })),
      byBranch: branchRes.rows.map((r) => ({
        branch: r.branch || '(ไม่ระบุ)',
        weight: Math.round((parseFloat(r.w) || 0) * 100) / 100,
      })),
      recent: recentRes.rows.map((r) => ({
        id: r.id,
        branch: r.branch,
        collectorName: r.collector_name,
        disposalLocation: r.disposal_location || '–',
        disposalSubmittedAt: r.disposal_submitted_at,
        approvedBy: r.approved_by,
        totalWeight: Math.round((parseFloat(r.total_weight) || 0) * 100) / 100,
      })),
    });
  } catch (err) {
    return sendServerError(res, err);
  }
});

router.get('/dashboard', requireLogin, requireRole('approver', 'superadmin', 'managerial'), async (req, res) => {
  try {
    const { pool } = req.app.locals;
    const role = req.session.user.role;
    const isSuperAdmin = role === 'superadmin';

    const statusRes = await pool.query(`SELECT status, COUNT(*) AS cnt FROM submissions GROUP BY status`);
    const counts = { total: 0, pending: 0, approved: 0, rejected: 0, completed: 0 };
    for (const row of statusRes.rows) {
      const n = parseInt(row.cnt, 10);
      counts[row.status] = n;
      counts.total += n;
    }

    const weightRes = await pool.query(
      `SELECT si.scrap_type, SUM(si.weight) AS w
       FROM submission_items si
       JOIN submissions s ON s.id = si.submission_id
       GROUP BY si.scrap_type`
    );

    const weightByGroup = { thin: 0, thick: 0, special: 0 };
    const weightByType = {};
    let totalWeight = 0;

    for (const row of weightRes.rows) {
      const w = parseFloat(row.w) || 0;
      totalWeight += w;
      weightByType[row.scrap_type] = Math.round(w * 100) / 100;
      for (const [group, types] of Object.entries(TYPE_GROUPS)) {
        if (types.includes(row.scrap_type)) weightByGroup[group] += w;
      }
    }

    const dayRes = await pool.query(
      `SELECT si.date::date AS d, SUM(si.weight) AS w
       FROM submission_items si
       JOIN submissions s ON s.id = si.submission_id
       WHERE si.date >= CURRENT_DATE - INTERVAL '13 days'
       GROUP BY d ORDER BY d`
    );

    const areaRes = await pool.query(
      `SELECT si.scrap_area, SUM(si.weight) AS w
       FROM submission_items si
       JOIN submissions s ON s.id = si.submission_id
       GROUP BY si.scrap_area ORDER BY w DESC LIMIT 8`
    );

    const branchRes = await pool.query(
      `SELECT s.branch, SUM(si.weight) AS w
       FROM submission_items si
       JOIN submissions s ON s.id = si.submission_id
       GROUP BY s.branch ORDER BY w DESC`
    );

    const recentRes = await pool.query(
      `SELECT id, branch, collector_name, status, submitted_at
       FROM submissions ORDER BY submitted_at DESC LIMIT 8`
    );

    let userStats = null;
    if (isSuperAdmin) {
      const uRes = await pool.query(`SELECT role, COUNT(*) AS cnt FROM users WHERE is_active=TRUE GROUP BY role`);
      userStats = { submitter: 0, approver: 0, superadmin: 0, managerial: 0 };
      for (const r of uRes.rows) {
        userStats[r.role] = parseInt(r.cnt, 10);
      }
    }

    return res.json({
      counts,
      totalWeight: Math.round(totalWeight * 100) / 100,
      weightByGroup: {
        thin: Math.round(weightByGroup.thin * 100) / 100,
        thick: Math.round(weightByGroup.thick * 100) / 100,
        special: Math.round(weightByGroup.special * 100) / 100,
      },
      weightByType,
      weightByDay: dayRes.rows.map((r) => ({
        date: r.d instanceof Date ? r.d.toISOString().split('T')[0] : String(r.d).split('T')[0],
        weight: parseFloat(r.w) || 0,
      })),
      weightByArea: areaRes.rows.map((r) => ({ area: r.scrap_area || '(ไม่ระบุ)', weight: parseFloat(r.w) || 0 })),
      weightByBranch: branchRes.rows.map((r) => ({ branch: r.branch || '(ไม่ระบุ)', weight: parseFloat(r.w) || 0 })),
      recentSubmissions: recentRes.rows.map((r) => ({
        id: r.id,
        branch: r.branch,
        collectorName: r.collector_name,
        status: r.status,
        submittedAt: r.submitted_at,
      })),
      userStats,
    });
  } catch (err) {
    return sendServerError(res, err);
  }
});

router.get('/stock-history', requireLogin, requireRole('approver', 'managerial', 'superadmin'), async (req, res) => {
  try {
    const { pool } = req.app.locals;
    const user = req.session.user;
    const { dateFrom, dateTo, direction } = req.query;
    let { branch } = req.query;

    if (user.role === 'managerial' && user.branch) branch = user.branch;

    const inParams = [];
    const inConds = [`s.status = 'completed'`];
    if (branch) { inParams.push(branch); inConds.push(`s.branch = $${inParams.length}`); }
    if (dateFrom) { inParams.push(dateFrom); inConds.push(`s.disposal_submitted_at >= $${inParams.length}::date`); }
    if (dateTo) { inParams.push(dateTo); inConds.push(`s.disposal_submitted_at < ($${inParams.length}::date + INTERVAL '1 day')`); }
    const inWhere = `WHERE ${inConds.join(' AND ')}`;

    const outParams = [];
    const outConds = [`status = 'confirmed_by_managerial'`];
    if (branch) { outParams.push(branch); outConds.push(`branch = $${outParams.length}`); }
    if (dateFrom) { outParams.push(dateFrom); outConds.push(`sale_date >= $${outParams.length}::date`); }
    if (dateTo) { outParams.push(dateTo); outConds.push(`sale_date <= $${outParams.length}::date`); }
    const outWhere = `WHERE ${outConds.join(' AND ')}`;

    const events = [];

    if (!direction || direction === 'in' || direction === 'all') {
      const subRes = await pool.query(
        `SELECT s.id, s.branch, s.collector_name, s.disposal_location,
                s.disposal_submitted_at, s.approved_by,
                COALESCE(SUM(si.weight),0) AS total_weight
         FROM submissions s
         LEFT JOIN submission_items si ON si.submission_id = s.id
         ${inWhere}
         GROUP BY s.id ORDER BY s.disposal_submitted_at DESC LIMIT 200`,
        inParams
      );

      const ids = subRes.rows.map((r) => r.id);
      const itemMap = {};
      if (ids.length > 0) {
        const itRes = await pool.query(
          `SELECT submission_id, scrap_type, SUM(weight) AS w
           FROM submission_items WHERE submission_id = ANY($1::uuid[])
           GROUP BY submission_id, scrap_type`,
          [ids]
        );

        for (const r of itRes.rows) {
          if (!itemMap[r.submission_id]) itemMap[r.submission_id] = {};
          const group = TYPE_GROUPS.thin.includes(r.scrap_type)
            ? 'thin'
            : TYPE_GROUPS.thick.includes(r.scrap_type)
              ? 'thick'
              : TYPE_GROUPS.special.includes(r.scrap_type)
                ? 'special'
                : null;
          if (group) {
            itemMap[r.submission_id][group] = (itemMap[r.submission_id][group] || 0) + (parseFloat(r.w) || 0);
          }
        }
      }

      for (const r of subRes.rows) {
        const wbg = itemMap[r.id] || {};
        events.push({
          direction: 'in',
          date: r.disposal_submitted_at instanceof Date
            ? r.disposal_submitted_at.toISOString().split('T')[0]
            : String(r.disposal_submitted_at).split('T')[0],
          branch: r.branch,
          totalWeight: Math.round((parseFloat(r.total_weight) || 0) * 100) / 100,
          weightByGroup: {
            thin: Math.round((wbg.thin || 0) * 100) / 100,
            thick: Math.round((wbg.thick || 0) * 100) / 100,
            special: Math.round((wbg.special || 0) * 100) / 100,
          },
          ref: r.id,
          collectorName: r.collector_name || '',
          approvedBy: r.approved_by || '',
          location: r.disposal_location || '',
          createdAt: r.disposal_submitted_at,
        });
      }
    }

    if (!direction || direction === 'out' || direction === 'all') {
      const saleRes = await pool.query(
        `SELECT * FROM scrap_sales ${outWhere} ORDER BY sale_date DESC, created_at DESC LIMIT 200`,
        outParams
      );

      const resolveSaleGroup = (scrapType) => {
        if (scrapType === 'thin' || scrapType === 'thick' || scrapType === 'special') return scrapType;
        if (TYPE_GROUPS.thin.includes(scrapType)) return 'thin';
        if (TYPE_GROUPS.thick.includes(scrapType)) return 'thick';
        if (TYPE_GROUPS.special.includes(scrapType)) return 'special';
        return 'special';
      };

      for (const r of saleRes.rows) {
        const grp = resolveSaleGroup(r.scrap_type);
        const w = parseFloat(r.weight_kg) || 0;
        events.push({
          direction: 'out',
          date: formatDateOnly(r.sale_date),
          branch: r.branch,
          totalWeight: Math.round(w * 100) / 100,
          weightByGroup: {
            thin: grp === 'thin' ? Math.round(w * 100) / 100 : 0,
            thick: grp === 'thick' ? Math.round(w * 100) / 100 : 0,
            special: grp === 'special' ? Math.round(w * 100) / 100 : 0,
          },
          ref: r.id,
          scrapType: grp,
          scrapTypeRaw: r.scrap_type,
          notes: r.notes || '',
          recordedBy: r.recorded_by || '',
          createdAt: r.created_at,
        });
      }
    }

    events.sort((a, b) => {
      const byDate = b.date.localeCompare(a.date);
      if (byDate !== 0) return byDate;
      return new Date(b.createdAt) - new Date(a.createdAt);
    });

    return res.json(events);
  } catch (err) {
    return sendServerError(res, err);
  }
});

module.exports = router;
