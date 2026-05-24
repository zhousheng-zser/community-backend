require("dotenv").config();
const { sequelize, Sequelize } = require("./src/models");

async function main() {
    try {
        // 1. Add group_type column if not exists
        await sequelize.query("ALTER TABLE categories ADD COLUMN group_type VARCHAR(50) DEFAULT NULL").catch(() => {});
        console.log("Column group_type ensured");

        const serviceGroups = {
            tidy: {
                categories: [
                    { name: "热门服务", icon_url: "/img/index/menuicon1.png", sort_order: 1 },
                    { name: "厨房收纳", icon_url: "/img/index/menuicon2.png", sort_order: 2 },
                    { name: "搬家整理", icon_url: "/img/index/menuicon3.png", sort_order: 3 },
                    { name: "全屋收纳", icon_url: "/img/index/menuicon4.png", sort_order: 4 },
                    { name: "衣橱收纳", icon_url: "/img/index/menuicon1.png", sort_order: 5 }
                ],
                services: [
                    { cat: "衣橱收纳", title: "衣橱整理收纳【2小时】", price: 196, img: "https://images.unsplash.com/photo-1558769132-cb1aea458c5e?w=300&q=80" },
                    { cat: "厨房收纳", title: "厨房整理收纳【2小时】", price: 196, img: "https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=300&q=80" },
                    { cat: "搬家整理", title: "日式打包复原整理【2小时】", price: 216, img: "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=300&q=80" },
                    { cat: "全屋收纳", title: "全屋整理收纳【3小时】", price: 292, img: "https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=300&q=80" },
                    { cat: "全屋收纳", title: "全屋整理收纳【4小时】", price: 385, img: "https://images.unsplash.com/photo-1484101403633-562f891dc89a?w=300&q=80" }
                ]
            },
            urgent_fix: {
                categories: [
                    { name: "热门服务", icon_url: "/img/index/menuicon1.png", sort_order: 1 },
                    { name: "净水器维修", icon_url: "/img/index/menuicon2.png", sort_order: 2 },
                    { name: "灯具维修", icon_url: "/img/index/menuicon3.png", sort_order: 3 },
                    { name: "柜子维修", icon_url: "/img/index/menuicon4.png", sort_order: 4 },
                    { name: "管道疏通", icon_url: "/img/index/menuicon1.png", sort_order: 5 },
                    { name: "手机维修", icon_url: "/img/index/menuicon2.png", sort_order: 6 },
                    { name: "电路维修", icon_url: "/img/index/menuicon3.png", sort_order: 7 },
                    { name: "水路维修", icon_url: "/img/index/menuicon4.png", sort_order: 8 },
                    { name: "马桶维修", icon_url: "/img/index/menuicon1.png", sort_order: 9 },
                    { name: "厨房烟道串味", icon_url: "/img/index/menuicon2.png", sort_order: 10 },
                    { name: "零星打胶家修杂事", icon_url: "/img/index/menuicon3.png", sort_order: 11 }
                ],
                services: [
                    { cat: "净水器维修", title: "净水器故障维修【1小时】", price: 128, img: "https://images.unsplash.com/photo-1607472586893-edb57bdc0e39?w=300&q=80" },
                    { cat: "灯具维修", title: "灯具线路与灯体维修【1小时】", price: 98, img: "https://images.unsplash.com/photo-1621905251918-48416bd8575a?w=300&q=80" },
                    { cat: "柜子维修", title: "柜门铰链滑轨维修【1小时】", price: 118, img: "https://images.unsplash.com/photo-1504148455328-c376907d081c?w=300&q=80" },
                    { cat: "管道疏通", title: "厨房/卫浴管道疏通【1小时】", price: 158, img: "https://images.unsplash.com/photo-1581682040780-73c3a61d45a0?w=300&q=80" },
                    { cat: "手机维修", title: "上门手机维修【1小时】", price: 129, img: "https://images.unsplash.com/photo-1586953208448-b95a79798f07?w=300&q=80" },
                    { cat: "电路维修", title: "家庭电路故障维修【1小时】", price: 169, img: "https://images.unsplash.com/photo-1621905251918-48416bd8575a?w=300&q=80" },
                    { cat: "水路维修", title: "家庭水路维修【1小时】", price: 159, img: "https://images.unsplash.com/photo-1607472586893-edb57bdc0e39?w=300&q=80" },
                    { cat: "马桶维修", title: "马桶维修与配件更换【1小时】", price: 139, img: "https://images.unsplash.com/photo-1581682040780-73c3a61d45a0?w=300&q=80" },
                    { cat: "厨房烟道串味", title: "厨房烟道串味治理【1小时】", price: 179, img: "https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=300&q=80" },
                    { cat: "零星打胶家修杂事", title: "零星打胶与家修杂事【1小时】", price: 99, img: "https://images.unsplash.com/photo-1504148455328-c376907d081c?w=300&q=80" }
                ]
            },
            beauty_home: {
                categories: [
                    { name: "热门服务", icon_url: "/img/index/menuicon1.png", sort_order: 1 },
                    { name: "上门纹绣", icon_url: "/img/index/menuicon2.png", sort_order: 2 },
                    { name: "上门美容", icon_url: "/img/index/menuicon3.png", sort_order: 3 },
                    { name: "化妆造型", icon_url: "/img/index/menuicon4.png", sort_order: 4 },
                    { name: "上门美甲", icon_url: "/img/index/menuicon1.png", sort_order: 5 },
                    { name: "上门美瞳", icon_url: "/img/index/menuicon2.png", sort_order: 6 },
                    { name: "上门美发", icon_url: "/img/index/menuicon3.png", sort_order: 7 }
                ],
                services: [
                    { cat: "上门纹绣", title: "上门纹绣咨询与设计【1小时】", price: 299, img: "https://images.unsplash.com/photo-1588611911484-8d590a0a6f92?w=300&q=80" },
                    { cat: "上门美容", title: "上门面部护理美容【1小时】", price: 169, img: "https://images.unsplash.com/photo-1487412912498-0447578fcca8?w=300&q=80" },
                    { cat: "化妆造型", title: "活动化妆造型【1小时】", price: 199, img: "https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?w=300&q=80" },
                    { cat: "上门美甲", title: "上门美甲基础款【1小时】", price: 129, img: "https://images.unsplash.com/photo-1604654894610-df63bc536371?w=300&q=80" },
                    { cat: "上门美瞳", title: "上门美瞳搭配服务【1小时】", price: 159, img: "https://images.unsplash.com/photo-1487412912498-0447578fcca8?w=300&q=80" },
                    { cat: "上门美发", title: "上门美发造型服务【1小时】", price: 189, img: "https://images.unsplash.com/photo-1560066984-138dadb4c035?w=300&q=80" }
                ]
            },
            appliance_clean: {
                categories: [
                    { name: "热门服务", icon_url: "/img/index/menuicon1.png", sort_order: 1 },
                    { name: "油烟机清洗", icon_url: "/img/index/menuicon2.png", sort_order: 2 },
                    { name: "洗衣机清洗", icon_url: "/img/index/menuicon3.png", sort_order: 3 },
                    { name: "冰箱清洗", icon_url: "/img/index/menuicon4.png", sort_order: 4 },
                    { name: "空调清洗", icon_url: "/img/index/menuicon1.png", sort_order: 5 }
                ],
                services: [
                    { cat: "油烟机清洗", title: "家用油烟机深度清洗【1.5小时】", price: 168, img: "https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=300&q=80" },
                    { cat: "洗衣机清洗", title: "滚筒洗衣机拆洗消毒【2小时】", price: 198, img: "https://images.unsplash.com/photo-1626806787461-7c1cdd443952?w=300&q=80" },
                    { cat: "冰箱清洗", title: "冰箱除味杀菌清洗【1小时】", price: 128, img: "https://images.unsplash.com/photo-1571175443880-a0d0b6c0d0e3?w=300&q=80" },
                    { cat: "空调清洗", title: "挂式空调蒸汽清洗【1小时】", price: 118, img: "https://images.unsplash.com/photo-1581578731548-c64695cc6952?w=300&q=80" }
                ]
            },
            pioneer_clean: {
                categories: [
                    { name: "热门服务", icon_url: "/img/index/menuicon1.png", sort_order: 1 },
                    { name: "新居开荒", icon_url: "/img/index/menuicon2.png", sort_order: 2 },
                    { name: "玻璃清洁", icon_url: "/img/index/menuicon3.png", sort_order: 3 },
                    { name: "地面打蜡", icon_url: "/img/index/menuicon4.png", sort_order: 4 }
                ],
                services: [
                    { cat: "新居开荒", title: "新房首次开荒保洁【按平米】", price: 8, img: "https://images.unsplash.com/photo-1584622650111-993a426f6d00?w=300&q=80" },
                    { cat: "玻璃清洁", title: "全屋玻璃内外清洁【2小时】", price: 158, img: "https://images.unsplash.com/photo-1527515637462-cff94eecc1ac?w=300&q=80" },
                    { cat: "地面打蜡", title: "实木地板打蜡养护【2小时】", price: 228, img: "https://images.unsplash.com/photo-1504148455328-c376907d081c?w=300&q=80" }
                ]
            },
            mite_remove: {
                categories: [
                    { name: "热门服务", icon_url: "/img/index/menuicon1.png", sort_order: 1 },
                    { name: "床垫除螨", icon_url: "/img/index/menuicon2.png", sort_order: 2 },
                    { name: "沙发除螨", icon_url: "/img/index/menuicon3.png", sort_order: 3 },
                    { name: "全屋除螨", icon_url: "/img/index/menuicon4.png", sort_order: 4 }
                ],
                services: [
                    { cat: "床垫除螨", title: "床垫深度除螨杀菌【1小时】", price: 188, img: "https://images.unsplash.com/photo-1631049307264-da0ec9d70304?w=300&q=80" },
                    { cat: "沙发除螨", title: "布艺沙发除螨清洗【1.5小时】", price: 218, img: "https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=300&q=80" },
                    { cat: "全屋除螨", title: "三房一厅全屋除螨套餐【3小时】", price: 398, img: "https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?w=300&q=80" }
                ]
            },
            furniture_care: {
                categories: [
                    { name: "热门服务", icon_url: "/img/index/menuicon1.png", sort_order: 1 },
                    { name: "木地板养护", icon_url: "/img/index/menuicon2.png", sort_order: 2 },
                    { name: "皮质沙发护理", icon_url: "/img/index/menuicon3.png", sort_order: 3 },
                    { name: "实木家具打蜡", icon_url: "/img/index/menuicon4.png", sort_order: 4 }
                ],
                services: [
                    { cat: "木地板养护", title: "实木地板清洁打蜡【2小时】", price: 268, img: "https://images.unsplash.com/photo-1503602642458-232111445639?w=300&q=80" },
                    { cat: "皮质沙发护理", title: "真皮沙发上油保养【1小时】", price: 198, img: "https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=300&q=80" },
                    { cat: "实木家具打蜡", title: "实木餐桌椅养护打蜡【1.5小时】", price: 228, img: "https://images.unsplash.com/photo-1506439773649-6e0eb8cfb237?w=300&q=80" }
                ]
            },
            baby_home: {
                categories: [
                    { name: "热门服务", icon_url: "/img/index/menuicon1.png", sort_order: 1 },
                    { name: "月嫂陪护", icon_url: "/img/index/menuicon2.png", sort_order: 2 },
                    { name: "育儿家务", icon_url: "/img/index/menuicon3.png", sort_order: 3 },
                    { name: "宝宝房整理", icon_url: "/img/index/menuicon4.png", sort_order: 4 }
                ],
                services: [
                    { cat: "月嫂陪护", title: "产后月嫂陪护体验【4小时】", price: 399, img: "https://images.unsplash.com/photo-1519689680058-324335c77eba?w=300&q=80" },
                    { cat: "育儿家务", title: "育儿家庭保洁助理【3小时】", price: 159, img: "https://images.unsplash.com/photo-1491013516832-7db643ee3a67?w=300&q=80" },
                    { cat: "宝宝房整理", title: "婴儿房收纳与安全整理【2小时】", price: 196, img: "https://images.unsplash.com/photo-1522771739844-6a9f6d5f14af?w=300&q=80" }
                ]
            },
            house_repair: {
                categories: [
                    { name: "热门服务", icon_url: "/img/index/menuicon1.png", sort_order: 1 },
                    { name: "防水补漏", icon_url: "/img/index/menuicon2.png", sort_order: 2 },
                    { name: "墙面修补", icon_url: "/img/index/menuicon3.png", sort_order: 3 },
                    { name: "门窗维修", icon_url: "/img/index/menuicon4.png", sort_order: 4 }
                ],
                services: [
                    { cat: "防水补漏", title: "厨卫防水查漏修补【2小时】", price: 268, img: "https://images.unsplash.com/photo-1503389152951-9f343605f61e?w=300&q=80" },
                    { cat: "墙面修补", title: "墙面开裂修补粉刷【按平米】", price: 35, img: "https://images.unsplash.com/photo-1560518883-ce09059eeffa?w=300&q=80" },
                    { cat: "门窗维修", title: "入户门合页更换调试【1小时】", price: 168, img: "https://images.unsplash.com/photo-1504148455328-c376907d081c?w=300&q=80" }
                ]
            }
        };

        const t = await sequelize.transaction();
        try {
            for (const [groupKey, groupData] of Object.entries(serviceGroups)) {
                const catMap = {};

                for (const cat of groupData.categories) {
                    const rows = await sequelize.query(
                        "SELECT id FROM categories WHERE name=? AND group_type=? LIMIT 1",
                        { replacements: [cat.name, groupKey], type: Sequelize.QueryTypes.SELECT, transaction: t }
                    );
                    if (rows.length > 0) {
                        catMap[cat.name] = rows[0].id;
                        console.log("Category exists: " + cat.name + " (" + groupKey + ") id=" + rows[0].id);
                    } else {
                        await sequelize.query(
                            "INSERT INTO categories (name, icon_url, sort_order, group_type, createdAt, updatedAt) VALUES (?,?,?,?,NOW(),NOW())",
                            { replacements: [cat.name, cat.icon_url, cat.sort_order, groupKey], transaction: t }
                        );
                        const newRows = await sequelize.query(
                            "SELECT id FROM categories WHERE name=? AND group_type=? LIMIT 1",
                            { replacements: [cat.name, groupKey], type: Sequelize.QueryTypes.SELECT, transaction: t }
                        );
                        catMap[cat.name] = newRows[0].id;
                        console.log("Inserted category: " + cat.name + " (" + groupKey + ") id=" + newRows[0].id);
                    }
                }

                for (const svc of groupData.services) {
                    const catId = catMap[svc.cat];
                    const existing = await sequelize.query(
                        "SELECT id FROM services WHERE title=? AND category_id=? LIMIT 1",
                        { replacements: [svc.title, catId], type: Sequelize.QueryTypes.SELECT, transaction: t }
                    );
                    if (existing.length > 0) {
                        await sequelize.query(
                            "UPDATE services SET price=?, cover_image=?, updatedAt=NOW() WHERE id=?",
                            { replacements: [svc.price, svc.img, existing[0].id], transaction: t }
                        );
                        console.log("Updated service: " + svc.title);
                    } else {
                        await sequelize.query(
                            "INSERT INTO services (category_id, title, description, price, cover_image, sales_count, createdAt, updatedAt) VALUES (?,?,?,?,?,0,NOW(),NOW())",
                            { replacements: [catId, svc.title, svc.title, svc.price, svc.img], transaction: t }
                        );
                        console.log("Inserted service: " + svc.title);
                    }
                }
            }

            await t.commit();
            console.log("All service groups seeded successfully!");
        } catch (e) {
            await t.rollback();
            throw e;
        }
        process.exit(0);
    } catch (e) {
        console.error("Failed:", e.message);
        process.exit(1);
    }
}

main();
