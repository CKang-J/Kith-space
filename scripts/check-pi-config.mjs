#!/usr/bin/env node
/**
 * Pi Agent 配置快速测试工具
 * 用于验证配置文件读写是否正常
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const PI_CONFIG_DIR = path.join(os.homedir(), '.pi', 'agent');
const PI_MODELS_FILE = path.join(PI_CONFIG_DIR, 'models.json');

async function checkConfig() {
  console.log('🔍 Pi Agent 配置检查工具\n');
  console.log('配置目录:', PI_CONFIG_DIR);
  console.log('配置文件:', PI_MODELS_FILE);
  console.log('');

  // 检查目录
  try {
    await fs.access(PI_CONFIG_DIR);
    console.log('✅ 配置目录存在');
  } catch {
    console.log('❌ 配置目录不存在');
    console.log('   正在创建目录...');
    await fs.mkdir(PI_CONFIG_DIR, { recursive: true });
    console.log('✅ 配置目录已创建');
  }

  // 检查配置文件
  try {
    const content = await fs.readFile(PI_MODELS_FILE, 'utf-8');
    console.log('✅ 配置文件存在');
    console.log('');

    // 尝试解析
    try {
      const config = JSON.parse(content);
      console.log('✅ JSON 解析成功');
      console.log('   供应商数量:', config.providers?.length || 0);

      if (config.providers && config.providers.length > 0) {
        console.log('');
        console.log('已配置的供应商:');
        config.providers.forEach((p, i) => {
          console.log(`  ${i + 1}. ${p.name} (${p.id})`);
          console.log(`     端点: ${p.baseUrl}`);
          console.log(`     模型: ${p.models?.length || 0} 个`);
        });
      }
    } catch (error) {
      console.log('❌ JSON 解析失败:', error.message);
      console.log('   配置文件内容:');
      console.log('   ' + content.split('\n').join('\n   '));
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log('⚠️  配置文件不存在');
      console.log('   正在创建默认配置...');

      const defaultConfig = {
        providers: []
      };

      await fs.writeFile(
        PI_MODELS_FILE,
        JSON.stringify(defaultConfig, null, 2),
        'utf-8'
      );

      console.log('✅ 默认配置已创建');
    } else {
      console.log('❌ 读取配置文件失败:', error.message);
    }
  }

  console.log('');
  console.log('📡 测试 API 端点...');

  try {
    const response = await fetch('http://localhost:3000/api/settings/pi-agent-config');

    if (response.ok) {
      const data = await response.json();
      console.log('✅ API 端点正常');
      console.log('   返回供应商数量:', data.providers?.length || 0);
    } else {
      console.log('❌ API 返回错误:', response.status);
      const error = await response.text();
      console.log('   错误信息:', error);
    }
  } catch (error) {
    console.log('❌ API 请求失败:', error.message);
    console.log('   请确保 Kith-space 服务器正在运行');
  }

  console.log('');
  console.log('✨ 检查完成');
}

checkConfig().catch(console.error);
